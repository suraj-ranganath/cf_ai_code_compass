// vectorize.ts - Vectorize integration for semantic search and embeddings

import type { Env, Tool } from './types';
import { parseRepoUrl, getFileContent } from './github';

/**
 * Generate embeddings for text using Workers AI
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  try {
    const model = env.EMBEDDING_MODEL || '@cf/baai/bge-base-en-v1.5';
    const response = await env.AI.run(model, {
      text: [text],
    });

    return response.data[0] || [];
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Chunk text into smaller pieces for embedding
 */
function chunkText(text: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Store file content embeddings in Vectorize with chunking for large files
 */
export async function storeFileEmbeddings(
  repoName: string,
  files: Array<{ path: string; content: string; language?: string }>,
  env: Env
): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      // Skip empty files
      if (!file.content || file.content.length === 0) {
        skipped++;
        continue;
      }

      // Chunk large files
      const chunks = chunkText(file.content, 1000);

      // Generate and store embeddings for each chunk
      const vectors = await Promise.all(
        chunks.map(async (chunk, index) => {
          const embedding = await generateEmbedding(chunk, env);
          return {
            id: `${repoName}:${file.path}:chunk${index}`,
            values: embedding,
            metadata: {
              repoName,
              filePath: file.path,
              language: file.language || 'unknown',
              chunkIndex: index,
              totalChunks: chunks.length,
              contentPreview: chunk.substring(0, 200),
            },
          };
        })
      );

      await env.VECTORIZE_INDEX.upsert(vectors);
      stored += chunks.length;
    } catch (error) {
      console.error(`Error embedding file ${file.path}:`, error);
      skipped++;
    }
  }

  return { stored, skipped };
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
 * Ingest entire repository into Vectorize
 */
export async function ingestRepository(
  repoUrl: string,
  env: Env
): Promise<{
  success: boolean;
  stats: {
    filesProcessed: number;
    chunksStored: number;
    filesSkipped: number;
    totalSize: number;
  };
  error?: string;
}> {
  try {
    const { owner, name } = parseRepoUrl(repoUrl);
    const repoName = `${owner}/${name}`;

    // Fetch repository tree
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/trees/main?recursive=1`,
      {
        headers: {
          'User-Agent': 'Cloudflare-Worker',
          ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data: any = await response.json();
    const maxFiles = parseInt(env.MAX_REPO_FILES || '50', 10);

    // Filter to source files only
    const sourceFiles = data.tree
      .filter((item: any) => item.type === 'blob')
      .filter((item: any) => {
        const ext = item.path.split('.').pop()?.toLowerCase();
        return ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'md', 'txt'].includes(ext || '');
      })
      .slice(0, maxFiles);

    // Fetch file contents
    const files = await Promise.all(
      sourceFiles.map(async (file: any) => {
        try {
          const content = await getFileContent(owner, name, file.path, 'main', env);
          return {
            path: file.path,
            content,
            language: file.path.split('.').pop() || 'unknown',
          };
        } catch (error) {
          console.error(`Error fetching ${file.path}:`, error);
          return null;
        }
      })
    );

    const validFiles = files.filter((f): f is { path: string; content: string; language: string } => f !== null);

    // Store embeddings
    const { stored, skipped } = await storeFileEmbeddings(repoName, validFiles, env);

    const totalSize = validFiles.reduce((sum, f) => sum + f.content.length, 0);

    return {
      success: true,
      stats: {
        filesProcessed: validFiles.length,
        chunksStored: stored,
        filesSkipped: skipped,
        totalSize,
      },
    };
  } catch (error) {
    console.error('Error ingesting repository:', error);
    return {
      success: false,
      stats: {
        filesProcessed: 0,
        chunksStored: 0,
        filesSkipped: 0,
        totalSize: 0,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
