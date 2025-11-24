# Vercel Deployment Guide

## ⚠️ Important Limitations

**Vercel is serverless** and has limitations with SSE (Server-Sent Events) and long-running connections:

1. **Function Timeout**: 
   - Free tier: 10 seconds
   - Pro tier: 60 seconds
   - Enterprise: 300 seconds

2. **No Persistent Connections**: Serverless functions are stateless and don't maintain connections between requests

3. **SSE Limitations**: SSE requires long-lived connections, which don't work well with serverless architecture

## Recommendation

**For MCP servers with SSE, we recommend:**
- ✅ **Render** (free tier available, supports long-running processes)
- ✅ **Railway** (paid, but reliable)
- ✅ **Fly.io** (free tier available)
- ❌ **Vercel** (not recommended for SSE/long-running connections)

## Alternative: If You Must Use Vercel

If you need to deploy on Vercel, you would need to:

1. **Refactor the architecture** to work without persistent connections
2. **Use stateless request/response** instead of SSE
3. **Handle sessions differently** (e.g., using external storage like Redis)

This would require significant code changes to the current implementation.

## Current Status

The `vercel.json` file is included, but the current codebase is designed for persistent HTTP servers (Render, Railway, Fly.io) and will not work properly on Vercel without major refactoring.

