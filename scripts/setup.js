#!/usr/bin/env node

/**
 * Setup script for Cloudflare Socratic Mentor
 * Helps create required Cloudflare resources
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';

console.log('🎓 Cloudflare Socratic Mentor Setup\n');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (error) {
    return null;
  }
}

// Check if wrangler is installed
console.log('✓ Checking for wrangler CLI...');
const wranglerVersion = exec('wrangler --version');
if (!wranglerVersion) {
  console.error('✗ Wrangler CLI not found. Install with: npm install -g wrangler');
  process.exit(1);
}
console.log(`  Found: ${wranglerVersion.trim()}\n`);

// Check if logged in
console.log('✓ Checking Cloudflare authentication...');
const whoami = exec('wrangler whoami');
if (!whoami || whoami.includes('You are not authenticated')) {
  console.error('✗ Not logged in to Cloudflare. Run: wrangler login');
  process.exit(1);
}
console.log('  Authenticated ✓\n');

// Create .dev.vars if it doesn't exist
console.log('✓ Checking .dev.vars...');
if (!existsSync('.dev.vars')) {
  if (existsSync('.dev.vars.example')) {
    writeFileSync('.dev.vars', readFileSync('.dev.vars.example', 'utf-8'));
    console.log('  Created .dev.vars from template');
  } else {
    writeFileSync('.dev.vars', '# Add your GITHUB_TOKEN here\nGITHUB_TOKEN=\n');
    console.log('  Created .dev.vars');
  }
} else {
  console.log('  Already exists ✓');
}
console.log('');

console.log('📦 Creating Cloudflare resources...\n');

// Create Vectorize index
console.log('1. Creating Vectorize index...');
const vectorizeCheck = exec('wrangler vectorize list');
if (vectorizeCheck && vectorizeCheck.includes('socratic-mentor-embeddings')) {
  console.log('   Already exists ✓');
} else {
  console.log('   Run: wrangler vectorize create socratic-mentor-embeddings --dimensions=768 --metric=cosine');
}

// Create KV namespaces
console.log('\n2. Creating KV namespaces...');
console.log('   Run: wrangler kv:namespace create KV_PREFS');
console.log('   Run: wrangler kv:namespace create KV_PREFS --preview');
console.log('   Then update the IDs in wrangler.toml');

// Create R2 bucket
console.log('\n3. Creating R2 bucket...');
const r2Check = exec('wrangler r2 bucket list');
if (r2Check && r2Check.includes('socratic-mentor-cache')) {
  console.log('   Already exists ✓');
} else {
  console.log('   Run: wrangler r2 bucket create socratic-mentor-cache');
}

console.log('\n✅ Setup complete!');
console.log('\nNext steps:');
console.log('  1. Add your GitHub token to .dev.vars');
console.log('  2. Update KV namespace IDs in wrangler.toml');
console.log('  3. Run: npm run dev');
console.log('  4. Visit: http://localhost:8787\n');
