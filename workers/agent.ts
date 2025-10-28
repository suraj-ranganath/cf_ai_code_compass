// agent.ts - Cloudflare Agent orchestration with Workers AI

import type { Env, SessionState, ChatMessage, AgentMessage, Tool } from './types';
import { repoMapTool } from './github';
import { semanticSearchTool, embedTextTool } from './vectorize';

/**
 * Load system prompt from prompts/system.socratic.txt
 * In production, this should be bundled or stored in KV
 */
const SYSTEM_PROMPT = `You are a Socratic teaching agent specialized in helping developers understand unfamiliar codebases.

Your teaching philosophy:
1. Never give direct answers - guide through questions
2. Build on prerequisite knowledge systematically
3. Use the actual repository code as teaching material
4. Adapt difficulty based on user responses
5. Celebrate progress and normalize struggle

When analyzing a repository:
- Start with high-level architecture
- Identify key patterns and conventions
- Extract core abstractions
- Map dependencies and data flow

When asking questions:
- Begin with broad conceptual questions
- Progressively narrow to specific implementation details
- Provide hints if user struggles (max 2 hints)
- Mark concepts where user struggles for flashcard generation

Your goal: Help the user build a mental model of the repository that enables confident contribution.`;

/**
 * Available tools for the agent
 */
export const tools: Tool[] = [
  repoMapTool,
  semanticSearchTool,
  embedTextTool,
  {
    name: 'generate_socratic_question',
    description: 'Generates a Socratic question based on code context and user understanding',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'The code or concept context',
        },
        difficulty: {
          type: 'number',
          description: 'Question difficulty 1-5',
        },
        previousAnswers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Previous user answers to adapt difficulty',
        },
      },
      required: ['context', 'difficulty'],
    },
    handler: async (params: any, env: Env) => {
      // This will use Workers AI to generate questions
      return { question: 'Stub question', hints: [] };
    },
  },
  {
    name: 'generate_study_plan',
    description: 'Creates a personalized 10-15 minute study plan based on user struggles',
    parameters: {
      type: 'object',
      properties: {
        struggles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concepts the user struggled with',
        },
        repoContext: {
          type: 'string',
          description: 'Repository name and goal',
        },
      },
      required: ['struggles', 'repoContext'],
    },
    handler: async (params: any, env: Env) => {
      // Generate study plan with Workers AI
      return { plan: [], estimatedMinutes: 15 };
    },
  },
  {
    name: 'generate_flashcards',
    description: 'Creates 5 flashcards for spaced repetition based on key concepts',
    parameters: {
      type: 'object',
      properties: {
        concepts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key concepts to create flashcards for',
        },
        repoName: {
          type: 'string',
          description: 'Repository name for context',
        },
      },
      required: ['concepts'],
    },
    handler: async (params: any, env: Env) => {
      // Generate flashcards with Workers AI
      return { flashcards: [] };
    },
  },
];

/**
 * Run the agent workflow with Workers AI
 * This uses Cloudflare's Agent SDK (if available) or direct AI calls
 */
export async function runAgentWorkflow(
  session: SessionState,
  userMessage: string,
  env: Env
): Promise<ChatMessage> {
  try {
    // Build conversation history
    const messages: AgentMessage[] = [
      { role: 'assistant', content: SYSTEM_PROMPT },
      ...session.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Call Workers AI (Llama 3.3)
    // Note: Actual Cloudflare Agents SDK may have different API
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      max_tokens: 1000,
      temperature: 0.7,
    });

    // Handle tool calls if any
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolResults = await Promise.all(
        response.tool_calls.map(async (toolCall: any) => {
          const tool = tools.find((t) => t.name === toolCall.function.name);
          if (!tool) {
            return { error: `Unknown tool: ${toolCall.function.name}` };
          }

          try {
            const result = await tool.handler(
              JSON.parse(toolCall.function.arguments),
              env
            );
            return result;
          } catch (error) {
            return { error: error instanceof Error ? error.message : 'Tool execution failed' };
          }
        })
      );

      // Continue conversation with tool results
      // TODO: Make another AI call with tool results
      return {
        role: 'assistant',
        content: response.content || 'I used some tools to analyze the repository. Let me explain what I found...',
        timestamp: Date.now(),
      };
    }

    return {
      role: 'assistant',
      content: response.content || 'I understand. Let me help you with that...',
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Error in agent workflow:', error);
    return {
      role: 'assistant',
      content: 'I encountered an error processing your request. Please try again.',
      timestamp: Date.now(),
    };
  }
}

/**
 * Generate flashcards from user struggles
 */
export async function generateFlashcards(
  struggles: string[],
  repoName: string,
  env: Env
): Promise<any[]> {
  const tool = tools.find((t) => t.name === 'generate_flashcards');
  if (!tool) return [];

  const result = await tool.handler(
    { concepts: struggles, repoName },
    env
  );

  return result.flashcards || [];
}

/**
 * Generate personalized study plan
 */
export async function generateStudyPlan(
  session: SessionState,
  env: Env
): Promise<any> {
  const tool = tools.find((t) => t.name === 'generate_study_plan');
  if (!tool) return null;

  const result = await tool.handler(
    {
      struggles: session.userStruggles,
      repoContext: `${session.repoUrl} - Goal: ${session.goal}`,
    },
    env
  );

  return result.plan || null;
}
