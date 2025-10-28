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
    name: 'generate_concept_primer',
    description: 'Generate a foundational primer document that prepares users for deep code exploration',
    parameters: {
      type: 'object',
      properties: {
        repoAnalysis: {
          type: 'object',
          description: 'Output from repo_map tool',
        },
        userGoal: {
          type: 'string',
          description: 'User stated learning objective',
        },
        userExperience: {
          type: 'string',
          description: 'Beginner, Intermediate, or Advanced',
        },
      },
      required: ['repoAnalysis', 'userGoal'],
    },
    handler: async (params: any, env: Env) => {
      const prompt = `Generate a repository primer document following this structure:

# Repository Primer: ${params.repoAnalysis.name}

## Overview
Write 2-3 sentences explaining what problem this project solves, who uses it, and its scope.

## Architecture
Describe the primary architectural pattern and key components. Repository info:
${JSON.stringify(params.repoAnalysis, null, 2)}

## Technology Stack
List technologies in order of importance with brief explanations.

## Foundational Concepts
For each prerequisite from the analysis, explain:
- Concept name and 1-sentence explanation
- Why it matters in this repo
- Difficulty rating (⭐️ Beginner, ⭐️⭐️ Intermediate, ⭐️⭐️⭐️ Advanced)

Prerequisites detected: ${JSON.stringify(params.repoAnalysis.prerequisites || [])}

## Code Hotspots
Highlight these files: ${JSON.stringify(params.repoAnalysis.hotspots || [])}

## Development Workflow
Explain setup, key commands, testing, and debugging.

## Your Learning Path: ${params.userGoal}
Provide specific guidance:
- Which files to start with
- Which concepts to prioritize
- Exploration order
- Estimated time

User experience level: ${params.userExperience || 'Intermediate'}

Generate a concise, actionable primer readable in 5-10 minutes.`;

      try {
        const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        const response = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are an expert technical educator creating repository primers.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 2000,
          temperature: 0.7,
        });

        return {
          primer: response.response || response.content || 'Error generating primer',
          estimatedReadTime: 8,
        };
      } catch (error) {
        console.error('Error generating primer:', error);
        return { primer: 'Error generating primer', estimatedReadTime: 0 };
      }
    },
  },
  {
    name: 'generate_socratic_question',
    description: 'Generate a Socratic question that guides understanding through inquiry',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Code snippet, file, or concept to question about',
        },
        difficulty: {
          type: 'number',
          description: 'Question difficulty 1-5',
        },
        previousAnswers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Previous user answers to calibrate difficulty',
        },
        userGoal: {
          type: 'string',
          description: 'User stated learning objective',
        },
      },
      required: ['context', 'difficulty'],
    },
    handler: async (params: any, env: Env) => {
      const difficultyDescriptions = {
        1: 'Beginner - Observation and identification',
        2: 'Developing - Understanding relationships',
        3: 'Competent - Analysis and prediction',
        4: 'Proficient - Synthesis and design',
        5: 'Expert - Critical evaluation',
      };

      const prompt = `Generate a Socratic question following these principles:

Context: ${params.context}

Difficulty Level ${params.difficulty}: ${difficultyDescriptions[params.difficulty as keyof typeof difficultyDescriptions] || 'Medium'}

Question Types:
- Observational: Direct user to notice patterns
- Analytical: Guide decomposition and understanding
- Predictive: Test mental model accuracy
- Comparative: Build connections to prior knowledge
- Metacognitive: Develop learning strategies

${params.previousAnswers && params.previousAnswers.length > 0 ? `Previous answers: ${params.previousAnswers.join(', ')}` : ''}
${params.userGoal ? `User goal: ${params.userGoal}` : ''}

Generate a JSON response with:
{
  "question": "The Socratic question",
  "type": "analytical|observational|predictive|comparative|metacognitive",
  "learningObjective": "What this question teaches",
  "hints": ["Hint 1", "Hint 2", "Hint 3"],
  "acceptableConcepts": ["concept1", "concept2"]
}

The question should guide discovery, not provide direct answers.`;

      try {
        const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        const response = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are a Socratic teaching expert. Generate questions that guide understanding through inquiry.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 800,
          temperature: 0.8,
        });

        const content = response.response || response.content || '{}';
        
        // Try to parse JSON from response
        try {
          const parsed = JSON.parse(content);
          return parsed;
        } catch {
          // Fallback if not valid JSON
          return {
            question: content,
            type: 'analytical',
            learningObjective: 'Understand the concept',
            hints: ['Consider the context carefully', 'Think about similar patterns', 'Review the code structure'],
            acceptableConcepts: [],
          };
        }
      } catch (error) {
        console.error('Error generating question:', error);
        return {
          question: 'What do you notice about this code?',
          type: 'observational',
          learningObjective: 'Begin exploration',
          hints: [],
          acceptableConcepts: [],
        };
      }
    },
  },
  {
    name: 'generate_study_plan',
    description: 'Create a personalized 10-15 minute study plan based on user struggles',
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
      const prompt = `Create a personalized study plan for a developer who struggled with these concepts:
${params.struggles.join(', ')}

Repository context: ${params.repoContext}

Generate a study plan that:
1. Takes 10-15 minutes total
2. Includes 3-5 learning activities
3. Builds from foundational to advanced
4. Uses the actual repository code
5. Includes time estimates for each activity

Format as JSON:
{
  "plan": [
    {
      "activity": "Read documentation for X",
      "estimatedMinutes": 3,
      "resources": ["file.ts", "https://docs.example.com"],
      "objective": "Understand the basic concept"
    }
  ],
  "totalMinutes": 15,
  "focusAreas": ["concept1", "concept2"]
}`;

      try {
        const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        const response = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are a learning plan designer specializing in efficient, focused study sessions.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        });

        const content = response.response || response.content || '{}';
        try {
          return JSON.parse(content);
        } catch {
          return {
            plan: [],
            totalMinutes: 15,
            focusAreas: params.struggles,
          };
        }
      } catch (error) {
        console.error('Error generating study plan:', error);
        return { plan: [], totalMinutes: 15, focusAreas: [] };
      }
    },
  },
  {
    name: 'generate_flashcards',
    description: 'Create exactly 5 spaced-repetition flashcards based on key concepts',
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
        sessionContext: {
          type: 'string',
          description: 'Code examples and explanations from session',
        },
      },
      required: ['concepts', 'repoName'],
    },
    handler: async (params: any, env: Env) => {
      const prompt = `Create exactly 5 spaced-repetition flashcards for these concepts from ${params.repoName}:
${params.concepts.join(', ')}

${params.sessionContext ? `Session context: ${params.sessionContext}` : ''}

Each flashcard must:
- Reference specific files, functions, or code in the repository
- Be testable with a clear correct answer
- Focus on one atomic concept
- Include difficulty rating (1-5)

Format as JSON array:
{
  "flashcards": [
    {
      "front": "Question about specific code in the repo",
      "back": "Answer with explanation and code reference",
      "concept": "Concept name",
      "difficulty": 3,
      "sourceFile": "path/to/file.ts",
      "codeExample": "optional code snippet"
    }
  ]
}

Create exactly 5 flashcards. Mix difficulties: 1-2 easy, 2-3 medium, 0-1 hard.`;

      try {
        const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        const response = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are a flashcard designer creating repository-specific study materials.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1500,
          temperature: 0.7,
        });

        const content = response.response || response.content || '{"flashcards": []}';
        try {
          const parsed = JSON.parse(content);
          return parsed;
        } catch {
          return { flashcards: [] };
        }
      } catch (error) {
        console.error('Error generating flashcards:', error);
        return { flashcards: [] };
      }
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
    // Build conversation history for AI
    const aiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...session.messages.map((msg) => ({
        role: msg.role === 'system' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Call Workers AI (Llama 3.3)
    const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const response = await env.AI.run(model, {
      messages: aiMessages,
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

      // Make another AI call with tool results for continued reasoning
      const followUpMessages = [
        ...aiMessages,
        {
          role: 'assistant',
          content: response.response || response.content || '',
        },
        {
          role: 'user',
          content: `Tool results: ${JSON.stringify(toolResults, null, 2)}\n\nPlease explain these findings to the user in a Socratic way.`,
        },
      ];

      const followUpResponse = await env.AI.run(model, {
        messages: followUpMessages,
        max_tokens: 1000,
        temperature: 0.7,
      });

      return {
        role: 'assistant',
        content: followUpResponse.response || followUpResponse.content || 'I analyzed the repository. Let me explain what I found...',
        timestamp: Date.now(),
      };
    }

    return {
      role: 'assistant',
      content: response.response || response.content || 'I understand. Let me help you with that...',
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
