// durable-object.ts - Durable Object for session state and WebSocket handling

import type { Env, SessionState, ChatMessage } from './types';

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
    const updates = await request.json();
    const session = await this.state.storage.get<SessionState>('session');

    if (!session) {
      return new Response('Session not found', { status: 404 });
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
      return new Response('Session not found', { status: 404 });
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

    // Handle incoming messages
    server.addEventListener('message', async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);

        if (data.type === 'voice') {
          // Handle voice input (base64 audio)
          await this.handleVoiceInput(data.audio, server);
        } else if (data.type === 'text') {
          // Handle text input
          await this.handleTextInput(data.message, server);
        }
      } catch (error) {
        server.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message',
        }));
      }
    });

    // Handle connection close
    server.addEventListener('close', () => {
      this.sessions.delete(sessionId);
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
   * Handle voice input
   * TODO: Integrate with Cloudflare Realtime API for speech-to-text
   */
  private async handleVoiceInput(audioData: string, socket: WebSocket): Promise<void> {
    // Stub: In production, use Realtime API for transcription
    const transcription = 'Voice input transcription placeholder';

    // Process as text
    await this.handleTextInput(transcription, socket);

    // Send back voice response (text-to-speech)
    socket.send(JSON.stringify({
      type: 'voice_response',
      text: 'Response placeholder',
      audio: 'base64_audio_placeholder',
    }));
  }

  /**
   * Handle text input
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

    // Add user message to session
    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };

    session.messages.push(userMessage);

    // TODO: Call agent workflow to get response
    // For now, send acknowledgment
    const response: ChatMessage = {
      role: 'assistant',
      content: `I received your message: "${message}". Let me analyze that...`,
      timestamp: Date.now(),
    };

    session.messages.push(response);
    session.lastActivityAt = Date.now();

    await this.state.storage.put('session', session);

    // Send response back
    socket.send(JSON.stringify({
      type: 'text_response',
      message: response.content,
    }));
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
