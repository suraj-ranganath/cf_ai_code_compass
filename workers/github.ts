// github.ts - GitHub API integration for repository analysis

import type {
  Env,
  RepoAnalysisResponse,
  GitHubRepo,
  GitHubTree,
  FileNode,
  CodeHotspot,
  Prerequisite,
} from './types';

/**
 * Parse GitHub repository URL into owner and repo name
 */
export function parseRepoUrl(repoUrl: string): GitHubRepo {
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    throw new Error('Invalid GitHub repository URL');
  }

  const owner = match[1];
  const name = match[2].replace(/\.git$/, '');

  return { owner, name, defaultBranch: 'main' }; // Will fetch actual default branch
}

/**
 * Fetch repository default branch
 */
async function getDefaultBranch(owner: string, repo: string, env: Env): Promise<string> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Socratic-Mentor',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch repository: ${response.statusText}`);
  }

  const data = await response.json() as any;
  return data.default_branch || 'main';
}

/**
 * Fetch repository tree (file structure)
 */
async function getRepoTree(
  owner: string,
  repo: string,
  branch: string,
  env: Env
): Promise<GitHubTree> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Socratic-Mentor',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch repository tree: ${response.statusText}`);
  }

  return await response.json() as GitHubTree;
}

/**
 * Fetch file content from GitHub
 */
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  env: Env
): Promise<string> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'Cloudflare-Socratic-Mentor',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText}`);
  }

  return await response.text();
}

/**
 * Determine file importance based on heuristics
 */
function calculateFileImportance(path: string, size: number = 0): number {
  let score = 0.5; // Base score

  // High importance files
  if (path.match(/README|CONTRIBUTING|ARCHITECTURE|DESIGN/i)) score += 0.4;
  if (path.match(/package\.json|requirements\.txt|Cargo\.toml|go\.mod/)) score += 0.3;
  if (path.match(/tsconfig|webpack|vite|rollup|babel\.config/)) score += 0.2;

  // Core code files
  if (path.match(/\/src\/.*\.(ts|js|py|go|rs|java)$/)) score += 0.2;
  if (path.match(/\/lib\/.*\.(ts|js|py|go|rs|java)$/)) score += 0.15;

  // Tests (less important for initial understanding)
  if (path.match(/test|spec|__tests__/i)) score -= 0.2;

  // Config and tooling (moderate importance)
  if (path.match(/\.(json|yaml|yml|toml|ini)$/)) score += 0.1;

  // Large files might be generated or less important
  if (size > 100000) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

/**
 * Convert GitHub tree to hierarchical FileNode structure
 */
function buildFileTree(tree: GitHubTree, maxFiles: number): FileNode[] {
  const nodes: FileNode[] = [];
  const sortedTree = tree.tree
    .filter((node) => node.type === 'blob') // Files only for now
    .map((node) => ({
      path: node.path,
      type: 'file' as const,
      size: node.size,
      importance: calculateFileImportance(node.path, node.size),
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, maxFiles);

  return sortedTree;
}

/**
 * Extract code hotspots (important files to focus on)
 * TODO: Enhance with actual code analysis
 */
function extractHotspots(files: FileNode[]): CodeHotspot[] {
  // For now, return top important files as hotspots
  return files
    .filter((f) => f.importance > 0.6)
    .slice(0, 5)
    .map((file) => ({
      file: file.path,
      lineStart: 1,
      lineEnd: 50, // Placeholder
      description: `Key file: ${file.path}`,
      importance: file.importance,
      concepts: [], // Will be populated by LLM
    }));
}

/**
 * Extract prerequisite concepts
 * TODO: Use LLM to analyze package.json, imports, etc.
 */
function extractPrerequisites(files: FileNode[]): Prerequisite[] {
  const prerequisites: Prerequisite[] = [];

  // Check for common frameworks/libraries in file paths
  const hasReact = files.some((f) => f.path.includes('react'));
  const hasTypescript = files.some((f) => f.path.endsWith('.ts') || f.path.endsWith('.tsx'));
  const hasPython = files.some((f) => f.path.endsWith('.py'));

  if (hasReact) {
    prerequisites.push({
      concept: 'React',
      description: 'JavaScript library for building user interfaces',
      externalLinks: ['https://react.dev/learn'],
      difficulty: 'intermediate',
    });
  }

  if (hasTypescript) {
    prerequisites.push({
      concept: 'TypeScript',
      description: 'Typed superset of JavaScript',
      externalLinks: ['https://www.typescriptlang.org/docs/'],
      difficulty: 'beginner',
    });
  }

  if (hasPython) {
    prerequisites.push({
      concept: 'Python',
      description: 'High-level programming language',
      externalLinks: ['https://docs.python.org/3/tutorial/'],
      difficulty: 'beginner',
    });
  }

  return prerequisites;
}

/**
 * Main function to analyze a GitHub repository
 */
export async function analyzeRepository(
  repoUrl: string,
  depth: number,
  env: Env
): Promise<RepoAnalysisResponse> {
  const { owner, name } = parseRepoUrl(repoUrl);
  const defaultBranch = await getDefaultBranch(owner, name, env);
  const tree = await getRepoTree(owner, name, defaultBranch, env);

  const maxFiles = parseInt(env.MAX_REPO_FILES || '100', 10);
  const structure = buildFileTree(tree, maxFiles);
  const hotspots = extractHotspots(structure);
  const prerequisites = extractPrerequisites(structure);

  // Generate primer (stub - will be enhanced with LLM)
  const primer = `Repository: ${owner}/${name}\n\n` +
    `This repository contains ${tree.tree.length} files. ` +
    `Key areas to focus on: ${hotspots.map((h) => h.file).join(', ')}.\n\n` +
    `Recommended prerequisites: ${prerequisites.map((p) => p.concept).join(', ')}.`;

  return {
    repoName: `${owner}/${name}`,
    structure,
    hotspots,
    prerequisites,
    primer,
    estimatedReadTime: Math.ceil(structure.length / 10), // ~10 files per minute
  };
}

/**
 * Tool definition for Cloudflare Agents
 */
export const repoMapTool = {
  name: 'get_repo_map',
  description: 'Analyzes a GitHub repository and returns its structure, key files, and prerequisites',
  parameters: {
    type: 'object',
    properties: {
      repoUrl: {
        type: 'string',
        description: 'The GitHub repository URL to analyze',
      },
      depth: {
        type: 'number',
        description: 'How deep to analyze (1-3, default 2)',
        default: 2,
      },
    },
    required: ['repoUrl'],
  },
  handler: async (params: { repoUrl: string; depth?: number }, env: Env) => {
    return await analyzeRepository(params.repoUrl, params.depth || 2, env);
  },
};
