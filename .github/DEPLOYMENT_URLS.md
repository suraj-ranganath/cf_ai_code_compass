# Deployment URLs Guide

## Stable Production URLs ✅

After configuring `--branch=main` in the CI/CD workflow, you now have **stable production URLs** that never change:

### Frontend (Cloudflare Pages)
- **Production**: https://code-compass.pages.dev
  - ✅ Stable URL - never changes
  - ✅ Deploys automatically on push to `main`
  - ✅ Globally distributed via CDN
  - ✅ Automatic HTTPS with Cloudflare SSL

### Backend (Cloudflare Workers)
- **Production**: https://cf-ai-repo-socratic-mentor.suranganath.workers.dev
  - ✅ Stable URL - never changes
  - ✅ Deploys automatically on push to `main`
  - ✅ Global edge network
  - ✅ Automatic HTTPS

## Preview URLs (For Testing)

Each CI/CD run also creates a **preview URL** for testing before going live:

### How Preview URLs Work:
```
Format: https://<commit-hash>.code-compass.pages.dev
Example: https://218fa7fd.code-compass.pages.dev
```

- Created for every push/PR
- Unique per commit
- Useful for testing changes before merge
- Automatically cleaned up after 30 days

## URL Configuration

### In CI/CD Workflow (`.github/workflows/deploy.yml`):
```yaml
# This creates the stable production deployment
command: pages deploy pages-frontend/dist --project-name=code-compass --branch=main
```

The `--branch=main` flag tells Cloudflare:
- This is a production deployment (not a preview)
- Use the production URL (socratic-mentor.pages.dev)
- Update the main site with these changes

### In Frontend Build:
```yaml
env:
  VITE_API_URL: https://cf-ai-repo-socratic-mentor.suranganath.workers.dev/api
```

This ensures the frontend always connects to the stable production backend.

## Custom Domain (Optional)

Want a custom domain like `app.yourcompany.com`?

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages → code-compass
2. Click "Custom domains"
3. Add your domain (e.g., `app.yourcompany.com`)
4. Update DNS:
   ```
   CNAME app code-compass.pages.dev
   ```
5. SSL certificate auto-provisions (free!)

Your stable production URL becomes:
- ✅ `https://app.yourcompany.com` (custom)
- ✅ `https://code-compass.pages.dev` (still works)

## Verifying Your Deployment

### Check Frontend Status:
```bash
curl https://code-compass.pages.dev
# Should return HTML
```

### Check Backend Health:
```bash
curl https://cf-ai-repo-socratic-mentor.suranganath.workers.dev/health
# Should return: {"status":"healthy","timestamp":...}
```

### Check API Connection:
```bash
curl https://cf-ai-repo-socratic-mentor.suranganath.workers.dev/api/health
# Should return: {"status":"healthy","timestamp":...}
```

## Deployment Flow

```
Push to main
    ↓
GitHub Actions runs
    ↓
┌──────────────────────┐
│  Lint & Type Check   │
└──────────────────────┘
    ↓
┌──────────────────────┐     ┌──────────────────────┐
│  Deploy Workers      │     │  Deploy Pages        │
│  with --branch=main  │     │  with --branch=main  │
└──────────────────────┘     └──────────────────────┘
    ↓                            ↓
✅ Stable Backend URL        ✅ Stable Frontend URL
```

## Troubleshooting

### "I see a preview URL instead of production URL"
- Make sure you pushed to the `main` branch
- Check that `--branch=main` is in the deploy command
- Preview URLs are created for non-main branches

### "My URL keeps changing"
- Old deployments without `--branch=main` create preview URLs
- After adding `--branch=main`, next push will use stable URL
- Previous preview URLs remain accessible for 30 days

### "Custom domain not working"
- Verify DNS CNAME record points to `code-compass.pages.dev`
- Allow 5-10 minutes for DNS propagation
- Check Cloudflare Dashboard → Pages → code-compass → Custom domains

## Summary

✅ **Production URL**: https://code-compass.pages.dev (stable, never changes)  
🔄 **Preview URLs**: https://[hash].code-compass.pages.dev (per-commit testing)  
🌐 **Custom Domain**: Configure in Cloudflare Dashboard (optional)  
🚀 **Deployment**: Automatic on push to `main` via GitHub Actions

Your site is now production-ready with stable URLs! 🎉
