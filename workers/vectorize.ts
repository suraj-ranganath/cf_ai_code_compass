// vectorize.ts - Vectorize integration for semantic search and embeddings

import type { Env, Tool } from './types';
import { parseRepoUrl, getFileContent, getDefaultBranch } from './github';

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
 * Generate a short hash for vector IDs to stay under 64 byte limit
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Store file embeddings in Vectorize (batch processing to avoid subrequest limits)
 */
export async function storeFileEmbeddings(
  repoName: string,
  files: Array<{ path: string; content: string; language: string }>,
  env: Env
): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;

  // Process only 2 chunks at a time to stay well under the 50 subrequest limit
  // Each embedding call = 1 subrequest, upsert = 1 subrequest
  // Total per file: 2 embeddings + 1 upsert = 3 subrequests
  const CHUNK_BATCH_SIZE = 2;
  
  for (const file of files) {
    try {
      const chunks = chunkText(file.content);
      const vectors: any[] = [];
      
      // Process only first few chunks to avoid subrequest limit
      const maxChunksPerFile = 10; // Limit chunks per file
      const chunksToProcess = chunks.slice(0, maxChunksPerFile);
      
      // Process chunks in small batches
      for (let i = 0; i < chunksToProcess.length; i += CHUNK_BATCH_SIZE) {
        const chunkBatch = chunksToProcess.slice(i, i + CHUNK_BATCH_SIZE);
        
        // Generate embeddings for this batch sequentially to stay under limit
        for (let j = 0; j < chunkBatch.length; j++) {
          try {
            const chunk = chunkBatch[j];
            const chunkIndex = i + j;
            const embedding = await generateEmbedding(chunk, env);
            
            // Create short ID using hash to stay under 64 byte limit
            const repoHash = hashString(repoName);
            const pathHash = hashString(file.path);
            const vectorId = `${repoHash}:${pathHash}:${chunkIndex}`;
            
            vectors.push({
              id: vectorId,
              values: embedding,
              metadata: {
                type: 'code',
                repoName,
                filePath: file.path,
                language: file.language || 'unknown',
                chunkIndex: chunkIndex,
                totalChunks: chunks.length,
                contentPreview: chunk.substring(0, 200),
              },
            });
          } catch (error) {
            console.error(`Error generating embedding:`, error);
            // Continue with other chunks even if one fails
          }
        }
        
        // Small delay between chunk batches
        if (i + CHUNK_BATCH_SIZE < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      // Upsert all vectors for this file at once
      if (vectors.length > 0) {
        await env.VECTORIZE_INDEX.upsert(vectors);
        stored += vectors.length;
      }
    } catch (error) {
      console.error(`Error embedding file ${file.path}:`, error);
      skipped++;
    }
    
    // Small delay between files
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return { stored, skipped };
}

/**
 * Semantic search over repository files - returns actual code content
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
      language: match.metadata?.language,
      score: match.score,
      content: match.metadata?.contentPreview,
      chunkIndex: match.metadata?.chunkIndex,
      totalChunks: match.metadata?.totalChunks,
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
  env: Env,
  startIndex: number = 0,
  batchSize: number = 3
): Promise<{
  success: boolean;
  stats: {
    filesProcessed: number;
    chunksStored: number;
    filesSkipped: number;
    totalSize: number;
  };
  hasMore: boolean;
  nextIndex: number;
  error?: string;
}> {
  try {
    const { owner, name } = parseRepoUrl(repoUrl);
    const repoName = `${owner}/${name}`;

    // Get the default branch first
    const defaultBranch = await getDefaultBranch(owner, name, env);

    // Fetch repository tree
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/trees/${defaultBranch}?recursive=1`,
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
    const allSourceFiles = data.tree
      .filter((item: any) => item.type === 'blob')
      .filter((item: any) => {
        const ext = item.path.split('.').pop()?.toLowerCase();
        return ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'md', 'txt'].includes(ext || '');
      })
      .slice(0, maxFiles);

    // Process only 2 files per batch to avoid subrequest limits
    // Each file can have multiple chunks, each needing embeddings
    const sourceFiles = allSourceFiles.slice(startIndex, startIndex + batchSize);
    const hasMore = startIndex + batchSize < allSourceFiles.length;

    if (sourceFiles.length === 0) {
      return {
        success: true,
        stats: {
          filesProcessed: 0,
          chunksStored: 0,
          filesSkipped: 0,
          totalSize: 0,
        },
        hasMore: false,
        nextIndex: startIndex,
      };
    }

    // Fetch file contents
    const files = await Promise.all(
      sourceFiles.map(async (file: any) => {
        try {
          const content = await getFileContent(owner, name, file.path, defaultBranch, env);
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
      hasMore,
      nextIndex: startIndex + batchSize,
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
      hasMore: false,
      nextIndex: startIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tool for semantic search
 */
export const semanticSearchTool: Tool = {
  name: 'search_code',
  description: 'Search through the repository code to find relevant files and functions. Use this when you need to find specific implementations, patterns, or examples in the codebase. Returns actual code snippets that match the query.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in natural language (e.g., "authentication middleware", "database connection logic", "error handling patterns")',
      },
      repoName: {
        type: 'string',
        description: 'The repository name to search within (use the repo name from the analysis)',
      },
      topK: {
        type: 'number',
        description: 'Maximum number of code snippets to return (default 5, max 10)',
      },
    },
    required: ['query', 'repoName'],
  },
  handler: async (params: { query: string; repoName: string; topK?: number }, env: Env) => {
    // Coerce topK to number if it's a string (LLM sometimes passes strings)
    const topKValue = typeof params.topK === 'string' ? parseInt(params.topK, 10) : (params.topK || 5);
    const results = await semanticSearch(params.query, params.repoName, env, topKValue);
    
    // Format results in a more useful way for the LLM
    if (results.length === 0) {
      return "No code found matching that query. The repository may not be fully indexed yet, or try rephrasing your search.";
    }
    
    return results.map((r, i) => `
[Result ${i + 1}] File: ${r.filePath} (${r.language})
Relevance: ${(r.score * 100).toFixed(1)}%
Code:
\`\`\`${r.language}
${r.content}
\`\`\`
${r.chunkIndex !== undefined ? `(Showing chunk ${r.chunkIndex + 1} of ${r.totalChunks})` : ''}
`).join('\n---\n');
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
