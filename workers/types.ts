// types.ts - Shared TypeScript interfaces and types

export interface Env {
  AI: any; // Workers AI binding
  VECTORIZE_INDEX: VectorizeIndex;
  DO_SESSIONS: DurableObjectNamespace;
  KV_PREFS: KVNamespace;
  R2_CACHE: R2Bucket;
  GITHUB_TOKEN?: string;
  ENVIRONMENT: string;
  MAX_REPO_FILES: string;
  QUIZ_QUESTIONS_COUNT: string;
  STUDY_PLAN_DURATION_MINUTES: string;
  LLM_MODEL: string;
  EMBEDDING_MODEL: string;
}

export interface RepoAnalysisRequest {
  repoUrl: string;
  goal: string;
  depth?: number; // How deep to analyze the repo
}

export interface RepoAnalysisResponse {
  repoName: string;
  structure: FileNode[];
  hotspots: CodeHotspot[];
  prerequisites: Prerequisite[];
  primer: string;
  estimatedReadTime: number; // minutes
}

export interface FileNode {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  importance: number; // 0-1 score
  children?: FileNode[];
}

export interface CodeHotspot {
  file: string;
  lineStart: number;
  lineEnd: number;
  description: string;
  importance: number;
  concepts: string[];
}

export interface Prerequisite {
  concept: string;
  description: string;
  externalLinks: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  audioUrl?: string; // For voice messages
  reasoningSteps?: ReasoningStep[]; // Tool calls and reasoning
}

export interface ReasoningStep {
  type: 'tool_call' | 'thinking' | 'result';
  toolName?: string;
  description: string;
  timestamp: number;
  result?: any;
}

export interface SocraticQuestion {
  id: string;
  question: string;
  context: string; // Related code or concept
  difficulty: number; // 1-5
  followUpHints: string[];
}

export interface QuizSession {
  questions: SocraticQuestion[];
  currentIndex: number;
  answers: {
    questionId: string;
    userAnswer: string;
    wasCorrect: boolean;
    struggled: boolean;
  }[];
}

export interface StudyPlan {
  title: string;
  durationMinutes: number;
  sections: StudySection[];
  flashcards: Flashcard[];
  generatedAt: number;
}

export interface StudySection {
  order: number;
  title: string;
  durationMinutes: number;
  objectives: string[];
  resources: {
    type: 'file' | 'doc' | 'concept';
    reference: string;
    description: string;
  }[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  concept: string;
  difficulty: number;
  sourceFile?: string;
}

export interface SessionState {
  id: string;
  repoUrl: string;
  goal: string;
  analysis?: RepoAnalysisResponse;
  messages: ChatMessage[];
  quizSession?: QuizSession;
  studyPlan?: StudyPlan;
  userStruggles: string[]; // Concepts the user struggled with
  createdAt: number;
  lastActivityAt: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (params: any, env: Env) => Promise<any>;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
}

// Vectorize types
export interface VectorizeIndex {
  upsert(vectors: VectorizeVector[]): Promise<VectorizeUpsertResult>;
  query(vector: number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>;
  getByIds(ids: string[]): Promise<VectorizeVector[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, any>;
}

export interface VectorizeQueryOptions {
  topK?: number;
  filter?: Record<string, any>;
  returnValues?: boolean;
  returnMetadata?: boolean;
}

export interface VectorizeMatches {
  matches: VectorizeMatch[];
  count: number;
}

export interface VectorizeMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, any>;
}

export interface VectorizeUpsertResult {
  count: number;
  ids: string[];
}

// GitHub API types
export interface GitHubRepo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface GitHubFile {
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
  url: string;
  content?: string; // base64 encoded
}

export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeNode[];
  truncated: boolean;
}

export interface GitHubTreeNode {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}
