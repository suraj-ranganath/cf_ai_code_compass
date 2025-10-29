# CI/CD Setup Guide

This repository uses GitHub Actions to automatically deploy to Cloudflare on every push to `main`.

## Required Secrets

You need to configure the following secrets in your GitHub repository:

### 1. CLOUDFLARE_API_TOKEN

**Create an API Token:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. **IMPORTANT:** Start with "Edit Cloudflare Workers" template, then add these additional permissions:
   - **Account Permissions:**
     - Workers Scripts > Edit ✅
     - Workers KV Storage > Edit ✅ **CRITICAL!**
     - Cloudflare Pages > Edit ✅
     - Account Settings > Read ✅
     - Workers Tail > Read (optional, for logs)
   - **User Permissions:**
     - User Details > Read ✅ (Required to avoid "Unable to retrieve email" warning)
   - **Account Resources:** Include > [Your Account Name]
   - **Zone Resources:** All zones
4. Click "Continue to summary"
5. Click "Create Token"
6. **Copy the token immediately** (you won't be able to see it again!)

**Add to GitHub:**
1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `CLOUDFLARE_API_TOKEN`
4. Value: Paste your API token
5. Click "Add secret"

### 2. CLOUDFLARE_ACCOUNT_ID

**Find your Account ID:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click on "Workers & Pages"
3. Your Account ID is displayed on the right side
4. Or get it from your wrangler.toml: `account_id = "..."`

**Add to GitHub:**
1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `CLOUDFLARE_ACCOUNT_ID`
4. Value: Your account ID (e.g., `8f28ea2f1dd73c71964e59682b50fda8`)
5. Click "Add secret"

## Optional: GITHUB_TOKEN Secret for Backend

If you want your Workers to access private repositories, add a GitHub Personal Access Token:

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. Click "Generate new token" → "Generate new token (classic)"
3. Name: "Cloudflare Workers - Repo Access"
4. Scopes: Select `repo` (Full control of private repositories)
5. Click "Generate token" and copy it

**Add to Cloudflare Workers:**
```bash
npx wrangler secret put GITHUB_TOKEN
# Paste your GitHub token when prompted
```

## Workflow Overview

The CI/CD pipeline consists of 3 jobs:

### 1. **Lint & Type Check** (runs on all pushes and PRs)
- TypeScript type checking for Workers
- TypeScript type checking for Frontend
- Ensures code quality before deployment

### 2. **Deploy Workers** (runs only on `main` push)
- Installs dependencies
- Deploys Workers to Cloudflare
- Automatic rollback on failure

### 3. **Deploy Pages** (runs only on `main` push)
- Installs frontend dependencies
- Builds production bundle with Vite
- Deploys to Cloudflare Pages
- Sets `VITE_API_URL` environment variable

## Testing Locally

Before pushing, test the workflow steps locally:

```bash
# Type check Workers
npx tsc --noEmit

# Type check Frontend
cd pages-frontend && npx tsc --noEmit

# Build Frontend
cd pages-frontend && npm run build

# Deploy Workers (manual)
npx wrangler deploy

# Deploy Pages (manual)
npx wrangler pages deploy pages-frontend/dist --project-name=socratic-mentor
```

## Troubleshooting

### "Error: kv bindings require kv write perms [code: 10023]"

This is the most common error! Your token is missing **Workers KV Storage > Edit** permission.

**Fix:**
1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Find your token and click "Edit"
3. Add: **Account > Workers KV Storage > Edit** ⚠️
4. Save changes
5. Re-run the workflow in GitHub Actions

**Why:** This project uses KV to store user preferences, so deployment requires KV write permissions.

### "Error: Authentication error [code: 10000]"

This means your API token doesn't have the required permissions.

**Fix:**
1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Find your token and click "Edit" (or create a new one)
3. Ensure it has these permissions:
   - ✅ Account > Workers Scripts > Edit
   - ✅ Account > Cloudflare Pages > Edit
   - ✅ Account > Account Settings > Read
   - ✅ User > User Details > Read (prevents "Unable to retrieve email" warning)
4. **Account Resources** must include your account
5. Save changes
6. If you created a new token, update `CLOUDFLARE_API_TOKEN` secret in GitHub

### "Unable to retrieve email for this user"

This warning appears when the token is missing `User > User Details > Read` permission. While it doesn't block deployment, it's better to add this permission for cleaner logs.

### "Error: Authentication error"
- Check that `CLOUDFLARE_API_TOKEN` is set correctly
- Verify token has correct permissions
- Token may have expired - generate a new one

### "Error: Unknown account"
- Check that `CLOUDFLARE_ACCOUNT_ID` matches your Cloudflare account
- Account ID should not have quotes around it

### Build fails on type check
- Run `npx tsc --noEmit` locally to see errors
- Fix TypeScript errors before pushing

### Pages deployment fails
- Check that project name matches: `socratic-mentor`
- Verify `VITE_API_URL` is set correctly in workflow
- Check Pages project exists in Cloudflare Dashboard

## Manual Deployment

If CI/CD fails, you can always deploy manually:

```bash
# Deploy Workers
npx wrangler deploy

# Deploy Pages
cd pages-frontend && npm run build
npx wrangler pages deploy dist --project-name=socratic-mentor
```

## Monitoring

View deployment status:
- **GitHub Actions**: Repository → Actions tab
- **Cloudflare Workers**: [Dashboard → Workers & Pages](https://dash.cloudflare.com/)
- **Logs**: `npx wrangler tail` for real-time Workers logs
