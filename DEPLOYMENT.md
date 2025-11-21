# Deployment Guide - CS2 Esports Backend

## Quick Start: Railway Deployment (Recommended)

Railway offers the easiest deployment with built-in Redis support.

### Step 1: Install Railway CLI
```bash
npm install -g @railway/cli
```

### Step 2: Login to Railway
```bash
railway login
```

### Step 3: Initialize Project
```bash
cd backend
railway init
```

### Step 4: Add Redis
```bash
railway add redis
```

### Step 5: Set Environment Variables
```bash
railway variables set PANDASCORE_API_KEY=vSxzlgYi6d1bmvpjPg8LoLcCsmSpK1WX3gIF5NoFx6QfI_TJPrw
railway variables set NODE_ENV=production
railway variables set CACHE_TTL=30
```

### Step 6: Deploy
```bash
railway up
```

### Step 7: Get Your URL
```bash
railway status
```
Copy the deployment URL (e.g., `https://your-app.railway.app`)

### Step 8: Update Flutter App
Edit `lib/config/api_config.dart`:
```dart
static const String backendServerUrl = 'https://your-app.railway.app';
```

---

## Alternative: Render Deployment

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Backend setup"
git remote add origin <your-github-repo>
git push -u origin main
```

### Step 2: Create Render Service
1. Go to https://render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Select the `backend` folder

### Step 3: Configure
- **Name**: `cs2-esports-backend`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### Step 4: Add Environment Variables
In Render dashboard:
- `PANDASCORE_API_KEY`: `vSxzlgYi6d1bmvpjPg8LoLcCsmSpK1WX3gIF5NoFx6QfI_TJPrw`
- `NODE_ENV`: `production`
- `PORT`: `3001`
- `CACHE_TTL`: `30`

### Step 5: Add Redis (Optional)
1. Click "New +" → "Redis"
2. Copy the Internal Redis URL
3. Add to environment variables:
   - `REDIS_URL`: `<internal-redis-url>`

### Step 6: Deploy
Click "Create Web Service"

---

## Testing Deployment

### Test Health Check
```bash
curl https://your-backend-url.com/
```

Expected response:
```json
{
  "status": "running",
  "message": "CS2 Esports Cache Server v2.0",
  "environment": "production",
  "redis": "connected"
}
```

### Test Matches Endpoint
```bash
curl https://your-backend-url.com/matches
```

---

## Update Flutter App

Edit `lib/config/api_config.dart`:

```dart
class ApiConfig {
  static const bool useLocalServer = false;
  
  // Production backend URL
  static const String backendServerUrl = 'https://your-production-url.com';
  
  static String get serverUrl => backendServerUrl;
}
```

---

## Monitoring

### Railway
```bash
railway logs
```

### Render
Check logs in Render dashboard under "Logs" tab

---

## Costs

### Railway
- **Free Tier**: $5 credit/month (enough for small apps)
- **Hobby**: $5/month per service
- **Redis**: Included in plan

### Render
- **Free Tier**: 750 hours/month
- **Starter**: $7/month
- **Redis**: $10/month (optional)

---

## Troubleshooting

### Port Already in Use
If deployment fails with `EADDRINUSE`:
- Railway/Render auto-assign ports
- Remove hardcoded port in `server.js`:
  ```javascript
  const PORT = process.env.PORT || 3001;
  ```

### Redis Connection Failed
- Check if Redis addon is installed
- Verify `REDIS_URL` environment variable
- Server will fallback to local cache if Redis unavailable

### API Rate Limit
- If you exceed PandaScore limits, increase `CACHE_TTL` to 60-120 seconds
- Consider upgrading PandaScore plan

---

## Next Steps

After deployment:
1. ✅ Test all endpoints with Postman/curl
2. ✅ Update Flutter app with production URL
3. ✅ Test app on real device
4. ✅ Monitor logs for errors
5. ✅ Set up alerts (optional)

---

**Need Help?** Check Railway/Render documentation or open an issue.
