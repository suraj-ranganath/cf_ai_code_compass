// vectorize.ts - Vectorize integration for semantic search and embeddings

import type { Env, Tool } from './types';

/**
 * Generate embeddings for text using Workers AI
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  try {
    const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [text],
    });

    return response.data[0] || [];
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Store file content embeddings in Vectorize
 */
export async function storeFileEmbeddings(
  repoName: string,
  files: Array<{ path: string; content: string }>,
  env: Env
): Promise<void> {
  const vectors = await Promise.all(
    files.map(async (file) => {
      const embedding = await generateEmbedding(file.content, env);
      return {
        id: `${repoName}:${file.path}`,
        values: embedding,
        metadata: {
          repoName,
          filePath: file.path,
          contentPreview: file.content.substring(0, 200),
        },
      };
    })
  );

  await env.VECTORIZE_INDEX.upsert(vectors);
}

/**
 * Semantic search over repository files
 */
export async function semanticSearch(
  query: string,
  repoName: string,
  env: Env,
  topK: number = 5
): Promise<any[]> {
  try {
    const queryEmbedding = await generateEmbedding(query, env);

    const results = await env.VECTORIZE_INDEX.query(queryEmbedding, {
      topK,
      filter: { repoName },
      returnMetadata: true,
    });

    return results.matches.map((match) => ({
      filePath: match.metadata?.filePath,
      score: match.score,
      preview: match.metadata?.contentPreview,
    }));
  } catch (error) {
    console.error('Error in semantic search:', error);
    return [];
  }
}

/**
 * Store concept embeddings from user interactions
 */
export async function storeConceptEmbedding(
  concept: string,
  context: string,
  sessionId: string,
  env: Env
): Promise<void> {
  const embedding = await generateEmbedding(`${concept}: ${context}`, env);

  await env.VECTORIZE_INDEX.upsert([
    {
      id: `concept:${sessionId}:${Date.now()}`,
      values: embedding,
      metadata: {
        type: 'concept',
        concept,
        context,
        sessionId,
        timestamp: Date.now(),
      },
    },
  ]);
}

/**
 * Find similar concepts the user has struggled with
 */
export async function findSimilarStruggles(
  query: string,
  sessionId: string,
  env: Env
): Promise<string[]> {
  const queryEmbedding = await generateEmbedding(query, env);

  const results = await env.VECTORIZE_INDEX.query(queryEmbedding, {
    topK: 3,
    filter: { type: 'concept', sessionId },
    returnMetadata: true,
  });

  return results.matches
    .map((match) => match.metadata?.concept as string)
    .filter(Boolean);
}

/**
 * Tool for semantic search
 */
export const semanticSearchTool: Tool = {
  name: 'semantic_search',
  description: 'Search repository files semantically based on a query',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query to search for',
      },
      repoName: {
        type: 'string',
        description: 'Repository name to search within',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default 5)',
        default: 5,
      },
    },
    required: ['query', 'repoName'],
  },
  handler: async (params: { query: string; repoName: string; topK?: number }, env: Env) => {
    return await semanticSearch(params.query, params.repoName, env, params.topK || 5);
  },
};

/**
 * Tool for embedding text
 */
export const embedTextTool: Tool = {
  name: 'embed_text',
  description: 'Generate vector embedding for text',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to embed',
      },
    },
    required: ['text'],
  },
  handler: async (params: { text: string }, env: Env) => {
    const embedding = await generateEmbedding(params.text, env);
    return { embedding, dimensions: embedding.length };
  },
};
