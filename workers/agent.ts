// agent.ts - Cloudflare Agent orchestration with Workers AI

import { runWithTools } from '@cloudflare/ai-utils';
import type { Env, SessionState, ChatMessage, AgentMessage, Tool } from './types';
import { repoMapTool } from './github';
import { semanticSearchTool, embedTextTool } from './vectorize';

/**
 * Load system prompt from prompts/system.socratic.txt
 * In production, this should be bundled or stored in KV
 */
const SYSTEM_PROMPT = `You are a Socratic teaching agent helping developers master unfamiliar codebases through guided inquiry.

## Your Teaching Philosophy
1. **Never give direct answers** - Guide through carefully crafted questions
2. **Ground everything in code** - Use actual repository code as your teaching material
3. **Adapt to the learner** - Adjust difficulty based on responses and struggle signals
4. **Build systematically** - Start with architecture, then dive into specifics
5. **Celebrate progress** - Acknowledge insights and normalize learning struggles

## Available Tools (Use These Strategically)

You have access to powerful tools to help you teach effectively. Use them to gather context BEFORE asking questions:

1. **analyze_repository_structure**: Use this FIRST when working with a new repository. It gives you the file structure, important files (entry points, configs, APIs), and detected technologies.

2. **search_code**: Use this when you need to find specific code examples or implementations. It returns actual code snippets that match your search query. Perfect for when the user asks "how does X work?" or "where is Y implemented?"

3. **generate_concept_primer**: Create comprehensive explanations of prerequisites or complex concepts. Use after you've gathered code examples with search_code.

## How to Use Tools Effectively

**When starting a new repository**:
- ALWAYS call analyze_repository_structure first to understand the layout
- Review the important files and technologies detected
- Use this context to ask initial questions

**When user asks about specific features**:
- Use search_code to find relevant implementations
- Example: If they ask "how does authentication work?", search for "authentication middleware" or "login handler"
- Base your Socratic questions on the actual code you find

**When user struggles with concepts**:
- Use search_code to find concrete examples in the codebase
- Generate questions that connect the code to the concept
- Don't explain - ask them to trace through the code

## Question Patterns

**Observational** (Entry-level):
"Looking at this file structure, what catches your attention?"
"In the code I found, what do you notice about how the data flows?"

**Analytical** (Intermediate):
"Why do you think the developers chose this approach?"
"What problem does this pattern solve in this codebase?"

**Predictive** (Advanced):
"What would happen if we changed this line?"
"How would adding a new feature here affect the rest of the system?"

**Metacognitive** (Expert):
"What strategy did you use to figure that out?"
"How would you approach debugging this?"

## Critical Rules

1. **Always search for code** when user asks about implementations - don't guess or rely only on repo structure
2. **Never mention tool names to the user** - they don't need to know you're calling "search_code", just present what you found naturally
3. **Format code nicely** - When showing code snippets, use markdown code blocks with syntax highlighting
4. **Cite your sources** - When referencing code, mention the file path
5. **Track struggles** - Note when users struggle with specific concepts for later flashcard generation

Your goal: Build a learner who can confidently navigate and contribute to ANY codebase by teaching them HOW to explore code, not just what the code does.`;

/**
 * Available tools for the agent
 */
export const tools: Tool[] = [
  repoMapTool,
  semanticSearchTool,
  embedTextTool,
  {
    name: 'generate_concept_primer',
    description: 'Create a comprehensive explanation document for complex concepts or technologies. Use this AFTER searching for code examples to provide structured learning material. Best for explaining prerequisites, design patterns, or architectural concepts.',
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
    description: 'Create a Socratic question to test understanding of a specific code snippet or concept. Use this to generate follow-up questions after the user has seen code examples. The question should guide discovery, not test memorization.',
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
 * Now captures reasoning steps for UI visualization
 */
export async function runAgentWorkflow(
  session: SessionState,
  userMessage: string,
  env: Env
): Promise<ChatMessage> {
  try {

    // Build context about the repository for the AI
    const repoContext = session.analysis ? `
Repository: ${session.analysis.repoName}
User Goal: ${session.goal}

Repository Structure:
${session.analysis.structure?.slice(0, 10).map((f: any) => `- ${f.path} (${f.language || 'file'})`).join('\n') || ''}

Key Files: ${session.analysis.hotspots?.map((h: any) => h.path).slice(0, 5).join(', ') || 'None identified'}

Prerequisites: ${session.analysis.prerequisites?.map((p: any) => p.name).slice(0, 5).join(', ') || 'None identified'}

Primer: ${session.analysis.primer || 'No primer available'}

You have analyzed this repository. Use this information to guide your Socratic questions.
Ask questions that help the user understand the architecture, key components, and how they work together.
` : '';

    // Build conversation history for AI
    const aiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + repoContext },
      ...session.messages.map((msg) => ({
        role: msg.role === 'system' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    
    // Convert our tools to the format expected by runWithTools
    const toolFunctions = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as {
        type: 'object';
        properties: { [key: string]: { type: string; description?: string } };
        required: string[];
      },
      function: async (args: any) => {
        // Log tool invocation
        console.log(`[Tool] ${t.name} called with args:`, args);

        const result = await t.handler(args, env);
        console.log(`[Tool] ${t.name} completed`);

        // Convert result to string if it's an object
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
    }));

    const response = await runWithTools(
      env.AI,
      model,
      {
        messages: aiMessages,
        tools: toolFunctions,
      }
    ) as any;

    console.log('[Agent] Workflow complete');

    return {
      role: 'assistant',
      content: response.response || response.content || response || 'I understand. Let me help you with that...',
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Error in agent workflow:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    return {
      role: 'assistant',
      content: `I encountered an error processing your request: ${errorMessage}. Please try again.`,
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
