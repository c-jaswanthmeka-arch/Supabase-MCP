# Deployment Guide - Supabase MCP Server

This guide covers deploying the Supabase MCP Server to various platforms.

## 🚀 Quick Deploy Options

### Option 1: Railway (Recommended - Easiest)
### Option 2: Render (Free Tier Available)
### Option 3: Fly.io (Global Edge Network)
### Option 4: Vercel (Serverless)
### Option 5: Docker (Any Platform)

---

## 📦 Prerequisites

1. **GitHub Repository** (recommended for all platforms)
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Build the project locally** (optional, platforms will build automatically)
   ```bash
   npm install
   npm run build
   ```

---

## 🚂 Railway Deployment

### Steps:

1. **Sign up** at [railway.app](https://railway.app)

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configure**
   - Railway will auto-detect Node.js
   - Uses `railway.json` configuration
   - Start command: `npm run start:http`

4. **Set Environment Variables** (if needed)
   - Go to Variables tab
   - Add `PORT` (optional, defaults to 3000)

5. **Deploy**
   - Railway will automatically build and deploy
   - Get your public URL from the dashboard

### Railway Configuration:
- **File:** `railway.json` (already created)
- **Build Command:** `npm run build`
- **Start Command:** `npm run start:http`
- **Port:** Auto-detected from `PORT` env var

### Cost: 
- Free tier available
- $5/month for hobby plan

---

## 🎨 Render Deployment

### Steps:

1. **Sign up** at [render.com](https://render.com)

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository

3. **Configure Service**
   - **Name:** `supabase-mcp-server`
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start:http`
   - **Plan:** Free or Starter

4. **Environment Variables**
   - `PORT`: `10000` (Render uses port 10000)
   - `NODE_ENV`: `production`

5. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy automatically
   - Get your public URL (e.g., `https://supabase-mcp-server.onrender.com`)

### Render Configuration:
- **File:** `render.yaml` (already created)
- **Auto-deploy:** Enabled by default
- **Port:** 10000 (Render requirement)

### Cost:
- Free tier available (with limitations)
- $7/month for Starter plan

---

## ✈️ Fly.io Deployment

### Steps:

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Sign up/Login**
   ```bash
   fly auth signup
   # or
   fly auth login
   ```

3. **Initialize Fly App**
   ```bash
   cd "/Users/devrev/Documents/Supabase MCP"
   fly launch
   ```
   - Follow prompts
   - Use existing `fly.toml` (already created)

4. **Deploy**
   ```bash
   fly deploy
   ```

5. **Get URL**
   ```bash
   fly open
   ```

### Fly.io Configuration:
- **File:** `fly.toml` (already created)
- **Region:** `iad` (Washington D.C.)
- **Port:** 8080

### Cost:
- Free tier available
- Pay-as-you-go pricing

---

## ▲ Vercel Deployment

### Steps:

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   cd "/Users/devrev/Documents/Supabase MCP"
   vercel
   ```

4. **Production Deploy**
   ```bash
   vercel --prod
   ```

### Vercel Configuration:
- **File:** `vercel.json` (already created)
- **Type:** Serverless Function
- **Auto-scaling:** Yes

### Cost:
- Free tier available
- Hobby plan: $20/month

### Note:
Vercel is serverless, so you may need to adjust the server code for serverless functions.

---

## 🐳 Docker Deployment

### Steps:

1. **Build Docker Image**
   ```bash
   docker build -t supabase-mcp-server -f .dockerfile .
   ```

2. **Run Container**
   ```bash
   docker run -p 3000:3000 supabase-mcp-server
   ```

3. **Deploy to Docker Hub**
   ```bash
   docker tag supabase-mcp-server yourusername/supabase-mcp-server
   docker push yourusername/supabase-mcp-server
   ```

4. **Deploy to any platform that supports Docker:**
   - AWS ECS
   - Google Cloud Run
   - Azure Container Instances
   - DigitalOcean App Platform
   - Heroku (with Docker)

### Docker Configuration:
- **File:** `.dockerfile` (already created)
- **Base Image:** `node:20-alpine`
- **Port:** 3000

---

## 🌐 Other Platform Options

### DigitalOcean App Platform

1. Go to [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform)
2. Create new app from GitHub
3. Configure:
   - Build command: `npm install && npm run build`
   - Run command: `npm run start:http`
   - Port: 3000

### Heroku

1. Install Heroku CLI
2. Create app: `heroku create supabase-mcp-server`
3. Deploy: `git push heroku main`
4. Set buildpack: `heroku buildpacks:set heroku/nodejs`

### AWS Elastic Beanstalk

1. Install EB CLI
2. Initialize: `eb init`
3. Create environment: `eb create`
4. Deploy: `eb deploy`

---

## 🔧 Environment Variables

All platforms support environment variables. Set these if needed:

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (production/development)

### For Production:
Consider moving Supabase credentials to environment variables:

```typescript
const SUPABASE_URL = process.env.SUPABASE_URL || "https://falunbwzjuhebsgtnrbx.supabase.co";
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY || "your-key";
```

---

## ✅ Post-Deployment Checklist

1. ✅ Test health endpoint: `GET https://your-app-url/`
2. ✅ Test API endpoint: `GET https://your-app-url/api/tools`
3. ✅ Update Postman collection with new URL
4. ✅ Test all endpoints
5. ✅ Monitor logs for errors

---

## 📊 Platform Comparison

| Platform | Free Tier | Ease of Use | Auto-Scale | Best For |
|----------|-----------|-------------|------------|----------|
| **Railway** | ✅ Yes | ⭐⭐⭐⭐⭐ | ✅ Yes | Quick deployment |
| **Render** | ✅ Yes | ⭐⭐⭐⭐ | ✅ Yes | Free tier users |
| **Fly.io** | ✅ Yes | ⭐⭐⭐ | ✅ Yes | Global edge network |
| **Vercel** | ✅ Yes | ⭐⭐⭐⭐ | ✅ Yes | Serverless |
| **Docker** | N/A | ⭐⭐⭐ | Manual | Custom deployments |

---

## 🎯 Recommended: Railway

**Why Railway?**
- ✅ Easiest setup
- ✅ Free tier available
- ✅ Auto-deploy from GitHub
- ✅ Built-in monitoring
- ✅ Simple configuration

**Quick Deploy:**
1. Push code to GitHub
2. Connect Railway to GitHub
3. Deploy automatically
4. Done! 🎉

---

## 📝 Notes

- All platforms will automatically build your TypeScript code
- Make sure `package.json` has correct start script
- Port is usually auto-detected, but set `PORT` env var if needed
- CORS is enabled, so API works from any origin
- No authentication required (as per your requirement)

---

## 🆘 Troubleshooting

### Build Fails
- Check Node.js version (should be 18+)
- Verify all dependencies in `package.json`
- Check build logs on platform

### Server Not Starting
- Verify start command: `npm run start:http`
- Check PORT environment variable
- Review server logs

### API Not Working
- Test health endpoint first
- Check CORS settings
- Verify Supabase credentials

---

## 🔗 Quick Links

- [Railway](https://railway.app)
- [Render](https://render.com)
- [Fly.io](https://fly.io)
- [Vercel](https://vercel.com)
- [Docker Hub](https://hub.docker.com)

