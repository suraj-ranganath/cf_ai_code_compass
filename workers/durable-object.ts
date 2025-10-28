// durable-object.ts - Durable Object for session state and WebSocket handling

import type { Env, SessionState, ChatMessage } from './types';
import { runAgentWorkflow } from './agent';

/**
 * SessionDurableObject manages persistent session state and WebSocket connections
 * for real-time voice/text interaction
 */
export class SessionDurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<string, WebSocket>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  /**
   * Handle HTTP and WebSocket requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal state management
    if (url.pathname === '/init') {
      return this.handleInit(request);
    }

    if (url.pathname === '/update') {
      return this.handleUpdate(request);
    }

    if (url.pathname === '/state') {
      return this.handleGetState();
    }

    // Handle WebSocket upgrade for Realtime API
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Initialize a new session
   */
  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json() as {
      sessionId: string;
      repoUrl: string;
      goal: string;
    };

    const sessionState: SessionState = {
      id: body.sessionId,
      repoUrl: body.repoUrl,
      goal: body.goal,
      messages: [],
      userStruggles: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    await this.state.storage.put('session', sessionState);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update session state
   */
  private async handleUpdate(request: Request): Promise<Response> {
    const updates = await request.json() as Partial<SessionState>;
    const session = await this.state.storage.get<SessionState>('session');

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatedSession: SessionState = {
      ...session,
      ...updates,
      lastActivityAt: Date.now(),
    };

    await this.state.storage.put('session', updatedSession);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get current session state
   */
  private async handleGetState(): Promise<Response> {
    const session = await this.state.storage.get<SessionState>('session');

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(session), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle WebSocket connection for real-time communication
   */
  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept the WebSocket connection
    server.accept();

    // Store the WebSocket connection
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, server);

    // Send connection acknowledgment
    server.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'WebSocket connected successfully',
    }));

    // Handle incoming messages
    server.addEventListener('message', async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);

        switch (data.type) {
          case 'voice':
            // Handle voice input (base64 audio)
            await this.handleVoiceInput(data.audio, server);
            break;
          
          case 'text':
            // Handle text input
            await this.handleTextInput(data.message, server);
            break;
          
          case 'ping':
            // Client keep-alive ping
            server.send(JSON.stringify({ type: 'pong' }));
            break;
          
          case 'pong':
            // Client responding to our heartbeat - just acknowledge
            console.log('Client heartbeat acknowledged');
            break;
          
          default:
            server.send(JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${data.type}`,
            }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        server.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message',
        }));
      }
    });

    // Handle connection close
    server.addEventListener('close', () => {
      this.sessions.delete(sessionId);
      console.log(`WebSocket closed for session ${sessionId}`);
    });

    // Handle errors
    server.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.sessions.delete(sessionId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle voice input - integrates with Cloudflare Workers AI for transcription
   */
  private async handleVoiceInput(audioData: string, socket: WebSocket): Promise<void> {
    try {
      // Send status update
      socket.send(JSON.stringify({
        type: 'status',
        message: 'Transcribing voice...',
      }));

      // Convert base64 to Uint8Array
      const audioBytes = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));

      // Use Cloudflare Workers AI Whisper model for transcription
      // The model expects a Uint8Array of audio data
      const response = await this.env.AI.run('@cf/openai/whisper', {
        audio: [...audioBytes], // Convert Uint8Array to regular array
      });

      const transcription = (response as { text?: string })?.text || '';

      if (!transcription) {
        throw new Error('No transcription returned');
      }

      // Send transcription back to client
      socket.send(JSON.stringify({
        type: 'transcription',
        text: transcription,
      }));

      // Process transcribed text through agent workflow
      await this.handleTextInput(transcription, socket);

    } catch (error) {
      console.error('Error handling voice input:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process voice input: ' + (error instanceof Error ? error.message : 'Unknown error'),
      }));
    }
  }

  /**
   * Handle text input - integrates with agent workflow
   */
  private async handleTextInput(message: string, socket: WebSocket): Promise<void> {
    const session = await this.state.storage.get<SessionState>('session');

    if (!session) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Session not found',
      }));
      return;
    }

    try {
      // Send processing status
      socket.send(JSON.stringify({
        type: 'status',
        message: 'Thinking...',
      }));

      // Add user message to session
      const userMessage: ChatMessage = {
        role: 'user',
        content: message,
        timestamp: Date.now(),
      };

      session.messages.push(userMessage);

      // Run agent workflow to get intelligent response
      console.log('Running agent workflow for message:', message);
      const agentResponse = await runAgentWorkflow(
        session,
        message,
        this.env,
        // Stream reasoning steps as they happen
        (step) => {
          socket.send(JSON.stringify({
            type: 'reasoning_step',
            step,
          }));
        }
      );
      console.log('Agent response received:', agentResponse);

      session.messages.push(agentResponse);
      session.lastActivityAt = Date.now();

      // Check if user struggled (simple heuristic: message contains "I don't know", "confused", etc.)
      const struggleIndicators = ['don\'t know', 'confused', 'unclear', 'help', 'stuck'];
      if (struggleIndicators.some(indicator => message.toLowerCase().includes(indicator))) {
        // Extract concepts from the conversation context
        const recentMessages = session.messages.slice(-5);
        const context = recentMessages.map(m => m.content).join(' ');
        
        // Simple concept extraction (in production, use NLP)
        const words = context.split(' ').filter(w => w.length > 6);
        if (words.length > 0 && !session.userStruggles.includes(words[0])) {
          session.userStruggles.push(words[0]);
        }
      }

      await this.state.storage.put('session', session);

      // Send response back
      console.log('Sending text_response to client');
      socket.send(JSON.stringify({
        type: 'text_response',
        message: agentResponse.content,
        timestamp: agentResponse.timestamp,
      }));
      console.log('Response sent successfully, connection still open');
    } catch (error) {
      console.error('Error handling text input:', error);
      // Send error but don't close the connection
      try {
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message: ' + (error instanceof Error ? error.message : 'Unknown error'),
        }));
      } catch (sendError) {
        console.error('Failed to send error message:', sendError);
      }
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: any): void {
    const messageStr = JSON.stringify(message);
    for (const socket of this.sessions.values()) {
      try {
        socket.send(messageStr);
      } catch (error) {
        // Socket may be closed, ignore error
      }
    }
  }

  /**
   * Cleanup on alarm (periodic maintenance)
   */
  async alarm(): Promise<void> {
    // Clean up old sessions (older than 24 hours)
    const session = await this.state.storage.get<SessionState>('session');
    if (session) {
      const age = Date.now() - session.lastActivityAt;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      if (age > maxAge) {
        await this.state.storage.deleteAll();
      }
    }
  }
}
