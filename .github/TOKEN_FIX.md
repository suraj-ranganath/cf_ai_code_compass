# Quick Fix: API Token Permissions

## The Error You're Seeing

```
✘ [ERROR] A request to the Cloudflare API failed.
  Authentication error [code: 10000]
```

## The Solution

Your `CLOUDFLARE_API_TOKEN` needs these exact permissions:

### 📋 Checklist

When creating/editing the token, verify:
- ✅ **Workers Scripts > Edit** - Deploy Workers
- ✅ **Workers KV Storage > Edit** - Required for KV bindings (CRITICAL!)
- ✅ **Cloudflare Pages > Edit** - Deploy frontend
- ✅ **Account Settings > Read** - Access account info
- ✅ **User Details > Read** - Prevent "unable to retrieve email" warning
- ✅ **Account Resources** - Your account is included
- ✅ **TTL** - No expiration (or far future date)

## Step-by-Step Fix

### Option 1: Edit Existing Token (Recommended)

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Find your existing token
3. Click "Edit"
4. Under "Permissions", add any missing ones from the list above
5. Click "Continue to summary"
6. Click "Save"
7. ✅ Token is updated (no need to update GitHub secret)

### Option 2: Create New Token

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Click "Use template" on "Edit Cloudflare Workers"
4. Add these additional permissions:
   - **Workers KV Storage > Edit** ⚠️ CRITICAL!
   - Cloudflare Pages > Edit
   - User Details > Read
5. Set "Account Resources" to your account
6. Click "Continue to summary"
7. Click "Create Token"
8. **Copy the token**
9. Update GitHub Secret:
   - Go to: `https://github.com/suraj-ranganath/cf_ai_repo_socratic_mentor/settings/secrets/actions`
   - Edit `CLOUDFLARE_API_TOKEN`
   - Paste new token
   - Click "Update secret"

## Verify It Works

After updating the token:

1. Go to GitHub Actions: https://github.com/suraj-ranganath/cf_ai_repo_socratic_mentor/actions
2. Click "Re-run jobs" on the failed workflow
3. It should now succeed! ✅

## Why This Error Happens

The "Edit Cloudflare Workers" template doesn't include:
- ❌ **Workers KV Storage > Edit** (CRITICAL - causes "kv bindings require kv write perms" error)
- ❌ Cloudflare Pages permissions (needed to deploy frontend)
- ❌ User Details read (needed to avoid warnings)

Your Worker uses KV for storing user preferences (`KV_PREFS`), so the token **must** have KV write permissions to deploy.
