const axios = require('axios');
const redisClient = require('../config/redis');
const notificationService = require('./notificationService');

const API_KEY = process.env.PANDASCORE_API_KEY;
const BASE_URL = 'https://api.pandascore.co';
const CACHE_KEY = 'cs2:matches';
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 30;

class PandaScoreService {
    constructor() {
        this.localCache = [];
        this.lastFetch = null;
    }

    async fetchMatches() {
        try {
            console.log('🔄 Fetching matches from PandaScore...');
            let pastMatches = [];
            let futureMatches = [];

            // Helper to format date without milliseconds (API compatibility)
            const formatDate = (d) => d.toISOString().split('.')[0] + 'Z';

            const now = new Date();
            const nowIso = formatDate(now);

            // Future limit: 1 year from now
            const futureDate = new Date();
            futureDate.setFullYear(futureDate.getFullYear() + 1);
            const futureIso = formatDate(futureDate);

            // Filter out matches older than 7 days
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            const cutoffIso = formatDate(cutoffDate);

            // 1. Fetch Future Matches (Now -> Future)
            // Sort: begin_at (Ascending) to get nearest future matches first
            // Reduced from 5 to 2 pages to stay within rate limits
            for (let page = 1; page <= 2; page++) {
                const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'sort': 'begin_at',
                        'filter[status]': 'running,not_started,finished,canceled',
                        'range[begin_at]': `${nowIso},${futureIso}`,
                        'per_page': 100,
                        'page': page
                    },
                    timeout: 10000
                });

                if (response.data.length === 0) break;
                futureMatches = [...futureMatches, ...response.data];
            }
            console.log(`� Fetched ${futureMatches.length} future matches`);

            // 2. Fetch Past Matches (Now -> Past)
            // Sort: -begin_at (Descending) to get nearest past matches first
            // Reduced from 5 to 2 pages to stay within rate limits
            for (let page = 1; page <= 2; page++) {
                const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'sort': '-begin_at',
                        'filter[status]': 'running,not_started,finished,canceled',
                        'range[begin_at]': `${cutoffIso},${nowIso}`,
                        'per_page': 100,
                        'page': page
                    },
                    timeout: 10000
                });

                if (response.data.length === 0) break;
                pastMatches = [...pastMatches, ...response.data];
            }
            console.log(`📜 Fetched ${pastMatches.length} past matches`);

            // 3. Fetch ALL Running (LIVE) Matches
            // Important: Fetch running matches separately to ensure we don't miss any due to date range issues
            let runningMatches = [];
            try {
                const response = await axios.get(`${BASE_URL}/csgo/matches/running`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'per_page': 100
                    },
                    timeout: 10000
                });
                runningMatches = response.data || [];
                console.log(`🔴 Fetched ${runningMatches.length} LIVE (running) matches`);
            } catch (error) {
                console.log('⚠️ Error fetching running matches:', error.message);
            }

            // Combine matches
            const allFetchedMatches = [...pastMatches, ...futureMatches, ...runningMatches];

            console.log(`📊 Total fetched from PandaScore: ${allFetchedMatches.length} matches`);

            // Get existing matches from Redis to preserve history
            let existingMatches = [];
            try {
                const cachedData = await redisClient.get(CACHE_KEY);
                if (cachedData && cachedData.matches) {
                    existingMatches = cachedData.matches;
                    console.log(`📦 Found ${existingMatches.length} existing matches in cache`);
                }
            } catch (e) {
                console.log('⚠️ Could not read existing cache for merging:', e.message);
            }

            // Merge: Create a map from existing matches, then overwrite with new fetched matches
            // This ensures we keep old matches that are no longer returned by the API window
            const matchMap = new Map(existingMatches.map(m => [m.id, m]));

            // Update with new data
            allFetchedMatches.forEach(m => {
                matchMap.set(m.id, m);
            });

            // Convert back to array and sort by date
            const uniqueMatches = Array.from(matchMap.values()).sort((a, b) => {
                return new Date(a.begin_at) - new Date(b.begin_at);
            });

            // Update local cache
            this.localCache = uniqueMatches;
            this.lastFetch = new Date().toISOString();

            // Update Redis cache
            const cacheData = {
                matches: uniqueMatches,
                lastUpdate: this.lastFetch,
                count: uniqueMatches.length
            };

            // Increase TTL to 7 days since we want to keep history
            // Or remove TTL if we want it forever, but 7 days of *inactivity* is reasonable
            await redisClient.set(CACHE_KEY, cacheData, 60 * 60 * 24 * 7);

            console.log(`✅ Updated cache with ${uniqueMatches.length} matches (History preserved)`);

            // Process match status changes for notifications
            await notificationService.processMatchUpdates(uniqueMatches);

            return cacheData;
        } catch (error) {
            console.error('❌ Error fetching matches:', error.message);
            if (error.response) {
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            return null;
        }
    }

    async getMatches() {
        // Try Redis first
        const cached = await redisClient.get(CACHE_KEY);
        if (cached) {
            console.log('📦 Serving from Redis cache');
            return cached;
        }

        // Fallback to local cache
        if (this.localCache.length > 0) {
            console.log('💾 Serving from local cache');
            return {
                matches: this.localCache,
                lastUpdate: this.lastFetch,
                count: this.localCache.length
            };
        }

        // No cache, fetch fresh
        console.log('🆕 No cache available, fetching fresh data');
        return await this.fetchMatches();
    }

    async searchTeams(query) {
        try {
            const response = await axios.get(`${BASE_URL}/csgo/teams`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                params: {
                    'search[name]': query,
                    'per_page': 20
                },
                timeout: 5000
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error searching teams:', error.message);
            throw error;
        }
    }

    async getTeamDetails(teamId) {
        try {
            const response = await axios.get(`${BASE_URL}/csgo/teams/${teamId}`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                timeout: 5000
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error fetching team details:', error.message);
            throw error;
        }
    }

    async getTeamPlayers(teamId) {
        try {
            const response = await axios.get(`${BASE_URL}/teams/${teamId}/players`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                params: {
                    'filter[active]': true
                },
                timeout: 5000
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error fetching team players:', error.message);
            throw error;
        }
    }
}

module.exports = new PandaScoreService();
