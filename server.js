require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const redisClient = require('./src/config/redis');
const pandascoreService = require('./src/services/pandascoreService');
const notificationService = require('./src/services/notificationService');
const teamsService = require('./src/services/teamsService');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to Redis
(async () => {
    console.log('🚀 Server starting... (Version: Logos Endpoint Added)');
    await redisClient.connect();
})();

// Initial fetch
pandascoreService.fetchMatches();

// Schedule updates every 60 seconds (reduced from 30s to avoid rate limits)
cron.schedule('*/60 * * * * *', () => {
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

// Register FCM token
app.post('/notifications/register', async (req, res) => {
    try {
        const { fcmToken, favoriteTeams, language } = req.body;

        if (!fcmToken || !favoriteTeams) {
            return res.status(400).json({
                error: 'fcmToken and favoriteTeams are required'
            });
        }

        const result = await notificationService.registerToken(fcmToken, favoriteTeams, language || 'en');
        res.json(result);
    } catch (error) {
        console.error('Error in /notifications/register:', error);
        res.status(500).json({ error: 'Failed to register FCM token' });
    }
});

// Unregister FCM token
app.post('/notifications/unregister', async (req, res) => {
    try {
        const { fcmToken } = req.body;

        if (!fcmToken) {
            return res.status(400).json({ error: 'fcmToken is required' });
        }

        const result = await notificationService.unregisterToken(fcmToken);
        res.json(result);
    } catch (error) {
        console.error('Error in /notifications/unregister:', error);
        res.status(500).json({ error: 'Failed to unregister FCM token' });
    }
});

// Get team logos
app.get('/teams/logos', async (req, res) => {
    try {
        const logos = await teamsService.getTeamLogos();
        res.json({ logos, count: Object.keys(logos).length });
    } catch (error) {
        console.error('Error in /teams/logos:', error);
        res.status(500).json({ error: 'Failed to fetch team logos' });
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
