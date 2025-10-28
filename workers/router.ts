// router.ts - Main Worker entry point with Hono routing

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, RepoAnalysisRequest, ChatMessage, SessionState } from './types';
import { analyzeRepository } from './github';
import { runAgentWorkflow, generateFlashcards, generateStudyPlan, tools } from './agent';
import { ingestRepository, semanticSearch } from './vectorize';
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

    // Ingest repository into Vectorize for semantic search
    // Process in small batches (3 files at a time) to stay under subrequest limit
    // Recursively process all files in separate request contexts
    c.executionCtx.waitUntil(
      (async () => {
        let startIndex = 0;
        let totalFiles = 0;
        let totalChunks = 0;
        
        // Process all files in batches
        while (true) {
          try {
            const result = await ingestRepository(repoUrl, c.env, startIndex, 3);
            totalFiles += result.stats.filesProcessed;
            totalChunks += result.stats.chunksStored;
            
            console.log(`Batch complete: ${result.stats.filesProcessed} files, ${result.stats.chunksStored} chunks (total: ${totalFiles} files, ${totalChunks} chunks)`);
            
            if (!result.hasMore) {
              console.log(`✅ Full repository ingested: ${totalFiles} files, ${totalChunks} chunks`);
              break;
            }
            
            startIndex = result.nextIndex;
            
            // Small delay between batches to avoid overwhelming
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            console.error(`Batch ingestion failed at index ${startIndex}:`, error);
            break;
          }
        }
      })()
    );

    return c.json({
      sessionId,
      analysis,
      message: 'Repository analyzed successfully. Ready for Socratic dialogue. (Repository is being indexed for semantic search in the background)',
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
    
    if (!sessionResponse.ok) {
      const errorData = await sessionResponse.json() as { error?: string };
      return c.json({
        error: errorData.error || 'Session not found',
        details: 'Please start by analyzing a repository first',
      }, 404);
    }
    
    const session = await sessionResponse.json() as SessionState;

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

// Transcribe voice to text using Cloudflare AI
app.post('/api/transcribe', async (c) => {
  try {
    const body = await c.req.json<{ audio: string; sessionId: string }>();
    const { audio, sessionId } = body;

    if (!audio || !sessionId) {
      return c.json({ error: 'audio and sessionId are required' }, 400);
    }

    // Convert base64 to ArrayBuffer
    const audioData = Uint8Array.from(atob(audio), c => c.charCodeAt(0));

    // Use Whisper model for transcription
    const response = await c.env.AI.run('@cf/openai/whisper', {
      audio: audioData.buffer,
    });

    const transcription = (response as { text?: string })?.text || '';

    if (!transcription) {
      return c.json({ error: 'Failed to transcribe audio' }, 500);
    }

    return c.json({
      transcription,
      sessionId,
    });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return c.json({
      error: 'Failed to transcribe audio',
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
    
    if (!sessionResponse.ok) {
      return c.json({ error: 'Session not found' }, 404);
    }
    
    const session = await sessionResponse.json() as SessionState;

    // Generate flashcards based on struggles
    const flashcardResults = await generateFlashcards(
      session.userStruggles || [],
      session.repoUrl || 'unknown',
      c.env
    );

    // Update session with flashcards
    await doStub.fetch('http://internal/update', {
      method: 'POST',
      body: JSON.stringify({ flashcards: flashcardResults }),
    });

    return c.json({ flashcards: flashcardResults });
  } catch (error) {
    console.error('Error generating flashcards:', error);
    return c.json({
      error: 'Failed to generate flashcards',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Generate study plan
app.post('/api/plan', async (c) => {
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
    
    if (!sessionResponse.ok) {
      return c.json({ error: 'Session not found' }, 404);
    }
    
    const session = await sessionResponse.json() as SessionState;

    // Generate study plan and flashcards
    const studyPlan = await generateStudyPlan(session, c.env);
    const flashcards = await generateFlashcards(
      session.userStruggles || [],
      session.repoUrl || 'unknown',
      c.env
    );

    // Update session
    await doStub.fetch('http://internal/update', {
      method: 'POST',
      body: JSON.stringify({ studyPlan, flashcards }),
    });

    return c.json({ studyPlan, flashcards });
  } catch (error) {
    console.error('Error generating study plan:', error);
    return c.json({
      error: 'Failed to generate study plan',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Ingest repository into Vectorize
app.post('/api/ingest', async (c) => {
  try {
    const repoUrl = c.req.query('repo');
    const startIndex = parseInt(c.req.query('start') || '0', 10);
    const batchSize = parseInt(c.req.query('batch') || '3', 10);

    if (!repoUrl) {
      return c.json({ error: 'repo query parameter is required' }, 400);
    }

    // Trigger ingestion
    const result = await ingestRepository(repoUrl, c.env, startIndex, batchSize);

    if (!result.success) {
      return c.json({
        error: 'Ingestion failed',
        details: result.error,
      }, 500);
    }

    return c.json({
      message: 'Repository ingested successfully',
      stats: result.stats,
      hasMore: result.hasMore,
      nextIndex: result.nextIndex,
    });
  } catch (error) {
    console.error('Error ingesting repository:', error);
    return c.json({
      error: 'Failed to ingest repository',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Generate concept primer
app.post('/api/primer', async (c) => {
  try {
    const body = await c.req.json<{
      sessionId?: string;
      repoUrl?: string;
      goal?: string;
      userExperience?: string;
    }>();

    let repoAnalysis;

    if (body.sessionId) {
      // Get analysis from session
      const doId = c.env.DO_SESSIONS.idFromName(body.sessionId);
      const doStub = c.env.DO_SESSIONS.get(doId);
      const sessionResponse = await doStub.fetch('http://internal/state');
      
      if (!sessionResponse.ok) {
        return c.json({ error: 'Session not found' }, 404);
      }
      
      const session = await sessionResponse.json() as SessionState;
      repoAnalysis = session.analysis;
    } else if (body.repoUrl) {
      // Analyze repository on the fly
      repoAnalysis = await analyzeRepository(body.repoUrl, 2, c.env);
    } else {
      return c.json({ error: 'sessionId or repoUrl is required' }, 400);
    }

    if (!repoAnalysis) {
      return c.json({ error: 'No repository analysis available' }, 400);
    }

    // Generate primer using the tool
    const primerTool = tools.find((t: any) => t.name === 'generate_concept_primer');
    if (!primerTool) {
      return c.json({ error: 'Primer tool not available' }, 500);
    }

    const primerResult = await primerTool.handler(
      {
        repoAnalysis,
        userGoal: body.goal || 'Understand the repository',
        userExperience: body.userExperience || 'Intermediate',
      },
      c.env
    );

    return c.json(primerResult);
  } catch (error) {
    console.error('Error generating primer:', error);
    return c.json({
      error: 'Failed to generate primer',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Semantic search endpoint
app.get('/api/search', async (c) => {
  try {
    const query = c.req.query('q');
    const repoName = c.req.query('repo');
    const topK = parseInt(c.req.query('topK') || '5', 10);

    if (!query) {
      return c.json({ error: 'q query parameter is required' }, 400);
    }

    const results = await semanticSearch(
      query,
      repoName || '',
      c.env,
      topK
    );

    return c.json({ results });
  } catch (error) {
    console.error('Error performing search:', error);
    return c.json({
      error: 'Failed to perform search',
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

// Export Durable Object class
export { SessionDurableObject };

// Export Worker handler
export default app;
