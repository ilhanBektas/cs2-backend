require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const redisClient = require('./src/config/redis');
const pandascoreService = require('./src/services/pandascoreService');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to Redis
(async () => {
    await redisClient.connect();
})();

// Initial fetch
pandascoreService.fetchMatches();

// Schedule updates every 30 seconds
cron.schedule('*/30 * * * * *', () => {
    console.log('⏰ Cron: Fetching matches...');
    pandascoreService.fetchMatches();
});

// ===== ROUTES =====

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'CS2 Esports Cache Server v2.0',
        environment: process.env.NODE_ENV,
        redis: redisClient.isConnected ? 'connected' : 'disconnected'
    });
});

// Get matches
app.get('/matches', async (req, res) => {
    try {
        const data = await pandascoreService.getMatches();
        if (!data) {
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
        res.json(data);
    } catch (error) {
        console.error('Error in /matches:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Team search
app.get('/teams/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const teams = await pandascoreService.searchTeams(query);
        res.json(teams);
    } catch (error) {
        console.error('Error in /teams/search:', error);
        res.status(500).json({ error: 'Failed to search teams' });
    }
});

// Team details
app.get('/teams/:id', async (req, res) => {
    try {
        const teamId = req.params.id;
        const team = await pandascoreService.getTeamDetails(teamId);
        res.json(team);
    } catch (error) {
        console.error('Error in /teams/:id:', error);
        res.status(500).json({ error: 'Failed to fetch team details' });
    }
});

// Team players
app.get('/teams/:id/players', async (req, res) => {
    try {
        const teamId = req.params.id;
        const players = await pandascoreService.getTeamPlayers(teamId);
        res.json(players);
    } catch (error) {
        console.error('Error in /teams/:id/players:', error);
        res.status(500).json({ error: 'Failed to fetch team players' });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await redisClient.disconnect();
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Auto-fetching matches every 30 seconds`);
    console.log(`💾 Redis cache: ${redisClient.isConnected ? '✅ Connected' : '❌ Disconnected'}`);
    console.log(`🔑 API Key: ${process.env.PANDASCORE_API_KEY ? '✅ Loaded' : '❌ Missing'}`);
    console.log(`📅 Filtering matches from Nov 21, 2025 onwards\n`);
});
