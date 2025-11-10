# 🚀 Quick Deployment Guide

## Fastest Way: Railway (Recommended)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

### Step 2: Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Sign up/Login
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your repository
6. Railway auto-detects and deploys! ✅

**That's it!** Your server will be live in ~2 minutes.

---

## Alternative: Render (Free Tier)

### Step 1: Push to GitHub (same as above)

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com)
2. Sign up/Login
3. Click "New +" → "Web Service"
4. Connect GitHub and select your repo
5. Configure:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start:http`
   - **Plan:** Free
6. Click "Create Web Service"

**Done!** Your server will be live at `https://your-app.onrender.com`

---

## Alternative: Fly.io (Global Edge)

### Step 1: Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### Step 2: Login
```bash
fly auth login
```

### Step 3: Deploy
```bash
cd "/Users/devrev/Documents/Supabase MCP"
fly launch
fly deploy
```

**Done!** Your server will be live globally.

---

## After Deployment

1. **Get your URL** from the platform dashboard
2. **Test it:**
   ```
   GET https://your-app-url/
   ```
3. **Update Postman** with your new URL
4. **Test all endpoints**

---

## Platform URLs

- **Railway:** `https://your-app.up.railway.app`
- **Render:** `https://your-app.onrender.com`
- **Fly.io:** `https://your-app.fly.dev`
- **Vercel:** `https://your-app.vercel.app`

---

## Need Help?

See `DEPLOYMENT.md` for detailed instructions for all platforms.

