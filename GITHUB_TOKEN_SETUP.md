# GitHub Token Setup

The application needs a GitHub Personal Access Token to avoid rate limiting when analyzing repositories.

## Quick Setup

1. **Create a GitHub Personal Access Token**:
   - Go to https://github.com/settings/tokens
   - Click "Generate new token" → "Generate new token (classic)"
   - Give it a descriptive name like "Socratic Mentor API"
   - Select scopes:
     - ✅ `public_repo` (to read public repositories)
     - ✅ `read:org` (optional, if analyzing org repos)
   - Click "Generate token"
   - **Copy the token immediately** (you won't see it again!)

2. **Add the token to your Worker**:
   ```bash
   cd /Users/suraj/Desktop/cf_ai_repo_socratic_mentor
   npx wrangler secret put GITHUB_TOKEN
   ```
   
   When prompted, paste your GitHub token.

3. **Verify it's set**:
   ```bash
   npx wrangler secret list
   ```

## Rate Limits

- **Without token**: 60 requests/hour per IP
- **With token**: 5,000 requests/hour

## Security Notes

- ✅ Tokens are stored securely as Cloudflare Worker secrets
- ✅ Tokens are never exposed in logs or responses
- ✅ Each environment (dev/prod) has separate secrets
- ⚠️ Never commit tokens to git
- ⚠️ Never share tokens publicly

## Testing After Setup

Test that the token is working:

```bash
curl -X POST https://cf-ai-repo-socratic-mentor.suranganath.workers.dev/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/facebook/react",
    "goal": "Understand React internals",
    "depth": 1
  }'
```

You should get a successful response instead of a rate limit error.

## Troubleshooting

If you get rate limit errors after setting the token:

1. Verify the token is set: `npx wrangler secret list`
2. Check the token has correct permissions on GitHub
3. Ensure the token hasn't expired
4. Try deleting and recreating: `npx wrangler secret delete GITHUB_TOKEN` then set it again

## Alternative: Use Environment Variable for Development

For local development, you can create a `.dev.vars` file:

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add your token
echo "GITHUB_TOKEN=your_github_token_here" >> .dev.vars
```

⚠️ Make sure `.dev.vars` is in your `.gitignore`!
