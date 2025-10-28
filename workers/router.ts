// router.ts - Main Worker entry point with Hono routing

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, RepoAnalysisRequest, ChatMessage } from './types';
import { analyzeRepository } from './github';
import { runAgentWorkflow } from './agent';
import { SessionDurableObject } from './durable-object';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for frontend
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
  });
});

// Analyze a GitHub repository
app.post('/api/analyze', async (c) => {
  try {
    const body = await c.req.json<RepoAnalysisRequest>();
    const { repoUrl, goal, depth = 2 } = body;

    if (!repoUrl || !goal) {
      return c.json({ error: 'repoUrl and goal are required' }, 400);
    }

    // Create a new session in Durable Object
    const sessionId = crypto.randomUUID();
    const doId = c.env.DO_SESSIONS.idFromName(sessionId);
    const doStub = c.env.DO_SESSIONS.get(doId);

    // Initialize session
    await doStub.fetch('http://internal/init', {
      method: 'POST',
      body: JSON.stringify({ sessionId, repoUrl, goal }),
    });

    // Start repository analysis
    const analysis = await analyzeRepository(repoUrl, depth, c.env);

    // Store analysis in session
    await doStub.fetch('http://internal/update', {
      method: 'POST',
      body: JSON.stringify({ analysis }),
    });

    return c.json({
      sessionId,
      analysis,
      message: 'Repository analyzed successfully. Ready for Socratic dialogue.',
    });
  } catch (error) {
    console.error('Error analyzing repository:', error);
    return c.json({
      error: 'Failed to analyze repository',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Chat endpoint (text or voice)
app.post('/api/chat', async (c) => {
  try {
    const body = await c.req.json<{ sessionId: string; message: string; isVoice?: boolean }>();
    const { sessionId, message, isVoice = false } = body;

    if (!sessionId || !message) {
      return c.json({ error: 'sessionId and message are required' }, 400);
    }

    // Get session from Durable Object
    const doId = c.env.DO_SESSIONS.idFromName(sessionId);
    const doStub = c.env.DO_SESSIONS.get(doId);

    // Get current session state
    const sessionResponse = await doStub.fetch('http://internal/state');
    const session = await sessionResponse.json();

    // Run agent workflow
    const agentResponse = await runAgentWorkflow(session, message, c.env);

    // Update session with new messages
    await doStub.fetch('http://internal/update', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: message, timestamp: Date.now() },
          agentResponse,
        ],
      }),
    });

    return c.json({
      response: agentResponse,
      sessionId,
    });
  } catch (error) {
    console.error('Error processing chat:', error);
    return c.json({
      error: 'Failed to process chat message',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Get session state
app.get('/api/session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id');
    const doId = c.env.DO_SESSIONS.idFromName(sessionId);
    const doStub = c.env.DO_SESSIONS.get(doId);

    const response = await doStub.fetch('http://internal/state');
    const session = await response.json();

    return c.json(session);
  } catch (error) {
    console.error('Error fetching session:', error);
    return c.json({
      error: 'Failed to fetch session',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Generate flashcards
app.post('/api/flashcards', async (c) => {
  try {
    const body = await c.req.json<{ sessionId: string }>();
    const { sessionId } = body;

    if (!sessionId) {
      return c.json({ error: 'sessionId is required' }, 400);
    }

    // Get session state
    const doId = c.env.DO_SESSIONS.idFromName(sessionId);
    const doStub = c.env.DO_SESSIONS.get(doId);
    const sessionResponse = await doStub.fetch('http://internal/state');
    const session = await sessionResponse.json();

    // Generate flashcards based on struggles
    const flashcards = await generateFlashcards(session, c.env);

    // Update session with flashcards
    await doStub.fetch('http://internal/update', {
      method: 'POST',
      body: JSON.stringify({ flashcards }),
    });

    return c.json({ flashcards });
  } catch (error) {
    console.error('Error generating flashcards:', error);
    return c.json({
      error: 'Failed to generate flashcards',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// WebSocket upgrade for Realtime API
app.get('/api/realtime/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const upgradeHeader = c.req.header('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426);
  }

  // Forward to Durable Object for WebSocket handling
  const doId = c.env.DO_SESSIONS.idFromName(sessionId);
  const doStub = c.env.DO_SESSIONS.get(doId);

  return doStub.fetch(c.req.raw);
});

// Stub for flashcard generation (will be implemented with agent.ts)
async function generateFlashcards(session: any, env: Env) {
  // TODO: Implement flashcard generation using Workers AI
  return [];
}

// Export Durable Object class
export { SessionDurableObject };

// Export Worker handler
export default app;
