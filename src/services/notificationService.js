const admin = require('firebase-admin');
const redisClient = require('../config/redis');

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
    if (firebaseInitialized) return;

    try {
        // Check if service account credentials are provided
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            // Decode base64 service account (for production)
            const serviceAccount = JSON.parse(
                Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8')
            );

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            // Use file path (for local development)
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
        } else {
            console.warn('⚠️ Firebase Admin SDK not initialized: No credentials found');
            return;
        }

        firebaseInitialized = true;
        console.log('✅ Firebase Admin SDK initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
    }
}

// Initialize on module load
initializeFirebase();

class NotificationService {
    constructor() {
        this.TOKENS_KEY = 'fcm:tokens'; // Hash: { token: JSON(favoriteTeams) }
        this.MATCH_STATUS_KEY = 'match:statuses'; // Hash: { matchId: status }
    }

    /**
     * Register a user's FCM token with their favorite teams
     * @param {string} fcmToken - Firebase Cloud Messaging token
     * @param {string[]} favoriteTeams - Array of favorite team names
     */
    async registerToken(fcmToken, favoriteTeams) {
        try {
            if (!fcmToken || !favoriteTeams || favoriteTeams.length === 0) {
                throw new Error('FCM token and favorite teams are required');
            }

            // Store token with favorite teams in Redis
            await redisClient.client.hSet(
                this.TOKENS_KEY,
                fcmToken,
                JSON.stringify(favoriteTeams)
            );

            console.log(`📲 Registered FCM token for ${favoriteTeams.length} teams`);
            return { success: true };
        } catch (error) {
            console.error('❌ Error registering FCM token:', error.message);
            throw error;
        }
    }

    /**
     * Unregister a user's FCM token
     * @param {string} fcmToken - Firebase Cloud Messaging token
     */
    async unregisterToken(fcmToken) {
        try {
            await redisClient.client.hDel(this.TOKENS_KEY, fcmToken);
            console.log('📲 Unregistered FCM token');
            return { success: true };
        } catch (error) {
            console.error('❌ Error unregistering FCM token:', error.message);
            throw error;
        }
    }

    /**
     * Process match status changes and send notifications
     * @param {Array} matches - Array of match objects
     */
    async processMatchUpdates(matches) {
        if (!firebaseInitialized) {
            return; // Skip if Firebase is not initialized
        }

        try {
            const statusChanges = [];

            for (const match of matches) {
                const prevStatus = await redisClient.client.hGet(
                    this.MATCH_STATUS_KEY,
                    match.id.toString()
                );

                const currentStatus = match.status;

                // Detect status changes
                if (prevStatus && prevStatus !== currentStatus) {
                    statusChanges.push({
                        match,
                        oldStatus: prevStatus,
                        newStatus: currentStatus
                    });

                    // Update stored status
                    await redisClient.client.hSet(
                        this.MATCH_STATUS_KEY,
                        match.id.toString(),
                        currentStatus
                    );
                } else if (!prevStatus) {
                    // First time seeing this match, store its status
                    await redisClient.client.hSet(
                        this.MATCH_STATUS_KEY,
                        match.id.toString(),
                        currentStatus
                    );
                }
            }

            // Send notifications for status changes
            for (const change of statusChanges) {
                await this.sendMatchNotifications(change);
            }
        } catch (error) {
            console.error('❌ Error processing match updates:', error.message);
        }
    }

    /**
     * Send notifications for a match status change
     * @param {Object} change - Match change object { match, oldStatus, newStatus }
     */
    async sendMatchNotifications(change) {
        const { match, oldStatus, newStatus } = change;

        try {
            // Get all registered tokens
            const tokenData = await redisClient.client.hGetAll(this.TOKENS_KEY);
            if (!tokenData || Object.keys(tokenData).length === 0) {
                return; // No registered users
            }

            const teamNames = [
                match.opponents[0]?.opponent?.name || 'Team 1',
                match.opponents[1]?.opponent?.name || 'Team 2'
            ];

            // Determine notification content based on status change
            let title, body;

            if (newStatus === 'running' && oldStatus === 'not_started') {
                // Match started
                title = '🔴 LIVE NOW';
                body = `${teamNames[0]} vs ${teamNames[1]} is starting!`;
            } else if (newStatus === 'finished' && oldStatus === 'running') {
                // Match finished
                const score1 = match.results?.[0]?.score || 0;
                const score2 = match.results?.[1]?.score || 0;
                const winner = score1 > score2 ? teamNames[0] : teamNames[1];

                title = '✅ MATCH FINISHED';
                body = `${winner} defeated ${score1 > score2 ? teamNames[1] : teamNames[0]} (${score1}-${score2})`;
            } else {
                return; // Ignore other status transitions
            }

            // Find tokens that have favorited either team
            const tokensToNotify = [];
            for (const [token, teamsJson] of Object.entries(tokenData)) {
                const favoriteTeams = JSON.parse(teamsJson);

                const isFavorite = teamNames.some(teamName =>
                    favoriteTeams.some(fav =>
                        this.matchesTeam(fav, teamName)
                    )
                );

                if (isFavorite) {
                    tokensToNotify.push(token);
                }
            }

            if (tokensToNotify.length === 0) {
                return; // No users interested in this match
            }

            // Send notification to all interested users
            const message = {
                notification: {
                    title,
                    body
                },
                data: {
                    match_id: match.id.toString(),
                    team1: teamNames[0],
                    team2: teamNames[1],
                    status: newStatus
                },
                tokens: tokensToNotify
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`📤 Sent ${response.successCount} notifications for match: ${teamNames[0]} vs ${teamNames[1]}`);

            // Remove failed tokens
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        failedTokens.push(tokensToNotify[idx]);
                    }
                });

                // Clean up invalid tokens
                for (const token of failedTokens) {
                    await redisClient.client.hDel(this.TOKENS_KEY, token);
                }
                console.log(`🗑️ Removed ${failedTokens.length} invalid FCM tokens`);
            }
        } catch (error) {
            console.error('❌ Error sending notifications:', error.message);
        }
    }

    /**
     * Check if a team name matches a favorite team (case-insensitive, handles aliases)
     * @param {string} favorite - Favorite team name
     * @param {string} teamName - Team name to check
     */
    matchesTeam(favorite, teamName) {
        const favLower = favorite.toLowerCase().trim();
        const teamLower = teamName.toLowerCase().trim();

        // Direct match
        if (favLower === teamLower) return true;

        // Common team aliases
        const aliases = {
            'navi': ['natus vincere', 'na\'vi', "na'vi"],
            'faze': ['faze clan'],
            'nip': ['ninjas in pyjamas'],
            'g2': ['g2 esports'],
            'vitality': ['team vitality'],
            'mouz': ['mousesports'],
            'liquid': ['team liquid'],
            'big': ['big clan'],
            'spirit': ['team spirit'],
            'ence': ['ence esports']
        };

        // Check if either name is an alias of the other
        for (const [key, aliasList] of Object.entries(aliases)) {
            if (favLower === key || aliasList.includes(favLower)) {
                if (teamLower === key || aliasList.includes(teamLower)) {
                    return true;
                }
            }
        }

        return false;
    }
}

module.exports = new NotificationService();
