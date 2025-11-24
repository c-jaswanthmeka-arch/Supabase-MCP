# Render Deployment Guide

## Quick Start Steps

### 1. Push Code to GitHub
Make sure your code is pushed to GitHub:
```bash
git add .
git commit -m "Add Render deployment configuration"
git push
```

### 2. Sign Up / Login to Render
- Go to [render.com](https://render.com)
- Sign up or login with your GitHub account

### 3. Create New Web Service
1. Click **"New +"** button (top right)
2. Select **"Web Service"**
3. Click **"Connect account"** if you haven't connected GitHub yet
4. Select your repository: `Supabase-MCP` (or your repo name)
5. Click **"Connect"**

### 4. Configure Service
Render will auto-detect the `render.yaml` file, but you can verify:

- **Name**: `supabase-mcp-server` (or any name)
- **Region**: Choose closest to you (e.g., `Oregon (US West)`)
- **Branch**: `main` (or your default branch)
- **Root Directory**: Leave empty (or `.` if needed)
- **Environment**: `Node`
- **Build Command**: `npm run build`
- **Start Command**: `npm run start:sse`
- **Plan**: `Free` (or choose a paid plan)

### 5. Deploy
1. Click **"Create Web Service"**
2. Render will:
   - Clone your repository
   - Install dependencies (`npm install`)
   - Build your app (`npm run build`)
   - Start your server (`npm run start:sse`)

### 6. Get Your URL
Once deployed, you'll get a URL like:
```
https://supabase-mcp-server.onrender.com
```

This is your MCP server endpoint!

## Important Notes

### Free Tier Limitations
- **Sleep Mode**: Service sleeps after 15 minutes of inactivity
- **Wake Time**: First request after sleep takes 30-60 seconds
- **Monthly Hours**: 750 hours/month (enough for one service)
- **Bandwidth**: 100GB/month

### For Production Use
Consider upgrading to a paid plan ($7/month) to:
- Avoid sleep mode
- Get faster response times
- Get more resources

## Testing Your Deployment

Once deployed, test your endpoint:
```bash
curl https://your-app-name.onrender.com/
```

You should see your MCP server responding.

## Updating Your Deployment

Any push to your `main` branch will automatically trigger a new deployment on Render.

## Environment Variables (Optional)

If you need to add environment variables:
1. Go to your service in Render dashboard
2. Click **"Environment"** tab
3. Add variables like:
   - `NODE_ENV=production`
   - Any other variables your app needs

## Troubleshooting

### Service Won't Start
- Check the **"Logs"** tab in Render dashboard
- Verify `npm run build` completes successfully
- Ensure `npm run start:sse` is the correct start command

### Service Sleeps Too Often
- Upgrade to a paid plan ($7/month)
- Or use a service like UptimeRobot to ping your service every 5 minutes

### Build Fails
- Check that all dependencies are in `package.json`
- Verify TypeScript compiles: `npm run build` locally
- Check Render logs for specific error messages

