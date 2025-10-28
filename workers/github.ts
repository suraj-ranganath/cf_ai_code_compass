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
/**
 * Get the default branch of a GitHub repository
 */
export async function getDefaultBranch(owner: string, repo: string, env: Env): Promise<string> {
  const headers: Record<string, string> = {
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
    const error = await response.text();
    throw new Error(`Failed to fetch repository: ${response.statusText} - ${error}`);
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
  const headers: Record<string, string> = {
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
    const error = await response.text();
    throw new Error(`Failed to fetch repository tree: ${response.statusText} - ${error}`);
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
  branch: string,
  env: Env
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'Cloudflare-Socratic-Mentor',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
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
  if (path.match(/package\.json|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml/)) score += 0.3;
  if (path.match(/tsconfig|webpack|vite|rollup|babel\.config/)) score += 0.2;
  if (path.match(/wrangler\.toml|vercel\.json|netlify\.toml/)) score += 0.25;

  // Entry points
  if (path.match(/main\.|index\.|app\.|server\./i)) score += 0.3;
  if (path.match(/\/api\//)) score += 0.2;
  if (path.match(/\/routes?\//)) score += 0.2;

  // Core code files
  if (path.match(/\/src\/.*\.(ts|js|py|go|rs|java|cpp|c)$/)) score += 0.2;
  if (path.match(/\/lib\/.*\.(ts|js|py|go|rs|java)$/)) score += 0.15;
  if (path.match(/\/workers?\//)) score += 0.2;

  // Tests (less important for initial understanding)
  if (path.match(/test|spec|__tests__|\.test\.|\.spec\./i)) score -= 0.2;

  // Config and tooling (moderate importance)
  if (path.match(/\.(json|yaml|yml|toml|ini)$/)) score += 0.1;

  // Generated/dist files (low importance)
  if (path.match(/\/dist\/|\/build\/|\/node_modules\/|\.min\./)) score -= 0.4;

  // Large files might be generated or less important
  if (size > 100000) score -= 0.2;
  if (size > 500000) score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

/**
 * Convert GitHub tree to hierarchical FileNode structure
 */
function buildFileTree(tree: GitHubTree, maxFiles: number): FileNode[] {
  const nodes: FileNode[] = [];
  const sortedTree = tree.tree
    .filter((node) => node.type === 'blob') // Files only for now
    .filter((node) => !node.path.includes('node_modules'))
    .filter((node) => !node.path.includes('.git/'))
    .map((node) => ({
      path: node.path,
      type: 'file' as const,
      size: node.size,
      language: getLanguageFromPath(node.path),
      importance: calculateFileImportance(node.path, node.size),
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, maxFiles);

  return sortedTree;
}

/**
 * Detect language from file extension
 */
function getLanguageFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    rb: 'Ruby',
    php: 'PHP',
    swift: 'Swift',
    kt: 'Kotlin',
    cs: 'C#',
  };
  return ext ? langMap[ext] : undefined;
}

/**
 * Extract code hotspots (important files to focus on)
 */
function extractHotspots(files: FileNode[], repoName: string): CodeHotspot[] {
  const hotspots: CodeHotspot[] = [];
  
  // Prioritize entry points, APIs, routers
  const categories = {
    entrypoints: files.filter(f => f.path.match(/main\.|index\.|app\.|server\./i)),
    apis: files.filter(f => f.path.match(/\/api\//)),
    routers: files.filter(f => f.path.match(/route|router/i)),
    config: files.filter(f => f.path.match(/config|wrangler|package\.json/i)),
    docs: files.filter(f => f.path.match(/README|CONTRIBUTING/i)),
  };

  // Add top files from each category
  Object.entries(categories).forEach(([category, categoryFiles]) => {
    categoryFiles.slice(0, 2).forEach(file => {
      hotspots.push({
        file: file.path,
        lineStart: 1,
        lineEnd: 100,
        description: `${category}: ${file.path.split('/').pop()}`,
        importance: file.importance,
        concepts: [],
      });
    });
  });

  return hotspots.slice(0, 10);
}

/**
 * Extract prerequisite concepts from file analysis
 */
async function extractPrerequisites(
  files: FileNode[],
  owner: string,
  repo: string,
  branch: string,
  env: Env
): Promise<Prerequisite[]> {
  const prerequisites: Prerequisite[] = [];

  // Check for package.json
  const packageJson = files.find(f => f.path === 'package.json');
  if (packageJson) {
    try {
      const content = await getFileContent(owner, repo, 'package.json', branch, env);
      const pkg = JSON.parse(content);
      
      // Extract key dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) {
        prerequisites.push({
          concept: 'React',
          description: 'JavaScript library for building user interfaces with components',
          externalLinks: ['https://react.dev/learn'],
          difficulty: 'intermediate',
        });
      }
      if (deps.next) {
        prerequisites.push({
          concept: 'Next.js',
          description: 'React framework with server-side rendering and routing',
          externalLinks: ['https://nextjs.org/docs'],
          difficulty: 'intermediate',
        });
      }
      if (deps.hono) {
        prerequisites.push({
          concept: 'Hono',
          description: 'Lightweight web framework for edge computing',
          externalLinks: ['https://hono.dev/'],
          difficulty: 'beginner',
        });
      }
    } catch (error) {
      // Ignore errors fetching package.json
    }
  }

  // Detect by file extensions
  const hasTypescript = files.some(f => f.language === 'TypeScript');
  const hasPython = files.some(f => f.language === 'Python');
  const hasGo = files.some(f => f.language === 'Go');
  const hasRust = files.some(f => f.language === 'Rust');

  if (hasTypescript) {
    prerequisites.push({
      concept: 'TypeScript',
      description: 'Typed superset of JavaScript that compiles to plain JavaScript',
      externalLinks: ['https://www.typescriptlang.org/docs/'],
      difficulty: 'beginner',
    });
  }

  if (hasPython) {
    prerequisites.push({
      concept: 'Python',
      description: 'High-level programming language with emphasis on readability',
      externalLinks: ['https://docs.python.org/3/tutorial/'],
      difficulty: 'beginner',
    });
  }

  if (hasGo) {
    prerequisites.push({
      concept: 'Go',
      description: 'Statically typed, compiled language designed for simplicity and efficiency',
      externalLinks: ['https://go.dev/tour/'],
      difficulty: 'intermediate',
    });
  }

  if (hasRust) {
    prerequisites.push({
      concept: 'Rust',
      description: 'Systems programming language focused on safety, speed, and concurrency',
      externalLinks: ['https://doc.rust-lang.org/book/'],
      difficulty: 'advanced',
    });
  }

  // Check for Cloudflare Workers
  const hasWrangler = files.some(f => f.path.includes('wrangler.toml'));
  if (hasWrangler) {
    prerequisites.push({
      concept: 'Cloudflare Workers',
      description: 'Serverless execution environment that runs on Cloudflare\'s edge network',
      externalLinks: ['https://developers.cloudflare.com/workers/'],
      difficulty: 'intermediate',
    });
  }

  return prerequisites.slice(0, 5); // Limit to top 5
}

/**
 * Generate repository primer text
 */
function generatePrimer(
  repoName: string,
  files: FileNode[],
  hotspots: CodeHotspot[],
  prerequisites: Prerequisite[]
): string {
  const totalFiles = files.length;
  const languages = [...new Set(files.map(f => f.language).filter(Boolean))].join(', ');
  
  return `**Repository: ${repoName}**\n\n` +
    `This repository contains ${totalFiles} key files written primarily in ${languages}.\n\n` +
    `**Key Areas to Explore:**\n` +
    hotspots.slice(0, 5).map(h => `- ${h.file}: ${h.description}`).join('\n') + '\n\n' +
    `**Foundational Concepts:**\n` +
    prerequisites.map(p => `- **${p.concept}** (${p.difficulty}): ${p.description}`).join('\n') + '\n\n' +
    `Start by exploring the entry points and configuration files to understand the project structure.`;
}

/**
 * Main function to analyze a GitHub repository
 * Returns JSON with modules, hot_paths, gotchas, symbols
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
  const hotspots = extractHotspots(structure, `${owner}/${name}`);
  const prerequisites = await extractPrerequisites(structure, owner, name, defaultBranch, env);
  const primer = generatePrimer(`${owner}/${name}`, structure, hotspots, prerequisites);

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
 * Tool definition for Cloudflare Agents - repo_map
 */
export const repoMapTool = {
  name: 'repo_map',
  description: 'Fetch GitHub repository structure, prioritize key files, identify hotspots and prerequisites',
  parameters: {
    type: 'object',
    properties: {
      repo_url: {
        type: 'string',
        description: 'The GitHub repository URL to analyze',
      },
    },
    required: ['repo_url'],
  },
  handler: async (params: { repo_url: string }, env: Env) => {
    const analysis = await analyzeRepository(params.repo_url, 2, env);
    
    return {
      modules: analysis.structure.map(f => f.path),
      hot_paths: analysis.hotspots.map(h => h.file),
      gotchas: analysis.prerequisites.map(p => `${p.concept}: ${p.description}`),
      symbols: analysis.hotspots.flatMap(h => h.concepts),
    };
  },
};
