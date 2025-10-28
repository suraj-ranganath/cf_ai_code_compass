// api.ts - API client for communicating with Workers backend

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface AnalyzeResponse {
  sessionId: string;
  analysis: {
    repoName: string;
    structure: any[];
    hotspots: any[];
    prerequisites: any[];
    primer: string;
    estimatedReadTime: number;
  };
  message: string;
}

export interface ChatResponse {
  response: {
    role: string;
    content: string;
    timestamp: number;
  };
  sessionId: string;
}

/**
 * Analyze a GitHub repository
 */
export async function analyzeRepo(repoUrl: string, goal: string, depth: number = 2): Promise<AnalyzeResponse> {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repoUrl, goal, depth }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to analyze repository');
  }

  return await response.json();
}

/**
 * Send a chat message
 */
export async function sendChat(sessionId: string, message: string, isVoice: boolean = false): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId, message, isVoice }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }

  return await response.json();
}

/**
 * Get session state
 */
export async function getSession(sessionId: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get session');
  }

  return await response.json();
}

/**
 * Request flashcard generation
 */
export async function generateFlashcards(sessionId: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/flashcards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate flashcards');
  }

  return await response.json();
}
