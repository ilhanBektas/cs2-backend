# CS2 Esports Backend Server

Production-ready cache server with Redis for the CS2 Esports mobile app.

## Features
- **Redis Cache**: Stores match data with 30-second TTL
- **Auto-refresh**: Fetches from PandaScore API every 30 seconds
- **Fallback**: Uses local cache if Redis unavailable
- **REST API**: Serves matches, teams, and player data

## API Endpoints

### Matches
- `GET /` - Health check
- `GET /matches` - Get all CS2 matches (cached)

### Teams
- `GET /teams/search?q=<query>` - Search teams
- `GET /teams/:id` - Get team details
- `GET /teams/:id/players` - Get team players

## Local Development

### Prerequisites
- Node.js 18+
- Redis (optional, uses local cache fallback)

### Setup
```bash
npm install
cp .env.example .env
# Edit .env with your PandaScore API key
```

### Run
```bash
# With Redis
redis-server
npm start

# Without Redis (local cache only)
npm start
```

## Deployment

### Railway (Recommended)
1. Install Railway CLI: `npm i -g @railway/cli`
2. Login: `railway login`
3. Initialize: `railway init`
4. Add Redis: `railway add redis`
5. Set env vars:
   ```bash
   railway variables set PANDASCORE_API_KEY=your_key_here
   ```
6. Deploy: `railway up`

### Render
1. Connect your GitHub repo to Render
2. Create new Web Service
3. Use `render.yaml` configuration
4. Add environment variables in Render dashboard
5. Add Redis addon (optional)

### Heroku
1. Install Heroku CLI
2. Create app: `heroku create`
3. Add Redis: `heroku addons:create heroku-redis:mini`
4. Set env vars:
   ```bash
   heroku config:set PANDASCORE_API_KEY=your_key_here
   ```
5. Deploy: `git push heroku main`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PANDASCORE_API_KEY` | PandaScore API key | - |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `CACHE_TTL` | Cache duration (seconds) | `30` |

## Architecture

```
Client Apps (Flutter)
       ↓
Backend Server (Node.js)
       ├─→ Redis Cache (30s TTL)
       └─→ PandaScore API (every 30s)
```

**Benefits:**
- 100x reduction in API calls
- Instant responses for clients
- Scalable to unlimited users
- Battery-efficient background updates

## Tech Stack
- **Express** - Web framework
- **Redis** - Cache layer
- **node-cron** - Scheduled tasks
- **axios** - HTTP client
- **dotenv** - Environment config

## License
MIT
