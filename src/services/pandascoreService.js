const axios = require('axios');
const redisClient = require('../config/redis');
const notificationService = require('./notificationService');

const API_KEY = process.env.PANDASCORE_API_KEY;
const BASE_URL = 'https://api.pandascore.co';
const CACHE_KEY = 'cs2:matches';

// Helper function to format dates for API compatibility
const formatDate = (d) => d.toISOString().split('.')[0] + 'Z';

class PandaScoreService {
    constructor() {
        this.localCache = [];
        this.lastFetch = null;
    }

    async _updateCache(newMatches) {
        try {
            // Get existing matches from Redis to preserve history
            let existingMatches = [];
            try {
                const cachedData = await redisClient.get(CACHE_KEY);
                if (cachedData && cachedData.matches) {
                    existingMatches = cachedData.matches;
                }
            } catch (e) {
                console.log('⚠️ Could not read existing cache for merging:', e.message);
            }

            // Merge: Create a map from existing matches, then overwrite with new fetched matches
            const matchMap = new Map(existingMatches.map(m => [m.id, m]));

            // Update with new data
            newMatches.forEach(m => {
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

            // Update Redis cache (7 days TTL)
            await redisClient.set(CACHE_KEY, cacheData, 60 * 60 * 24 * 7);

            await notificationService.processMatchUpdates(uniqueMatches);

            return cacheData;
        } catch (error) {
            console.error('❌ Error updating cache:', error.message);
            return null;
        }
    }

    // Note: Detail endpoint (/csgo/matches/{id}) requires premium API access (403 Forbidden)
    // We use streams and official_stream_url from list endpoint instead

    async fetchLiveMatches() {
        try {
            const now = new Date();

            // Range: -12 hours to +12 hours (covers live, recent, and upcoming matches)
            const start = new Date(now);
            start.setHours(start.getHours() - 12);

            const end = new Date(now);
            end.setHours(end.getHours() + 12);

            const startIso = formatDate(start);
            const endIso = formatDate(end);

            const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                params: {
                    'sort': 'begin_at',
                    'filter[status]': 'running,not_started,finished',
                    'range[begin_at]': `${startIso},${endIso}`,
                    'per_page': 100
                },
                timeout: 5000
            });

            const matches = response.data || [];

            // List endpoint already includes streams and official_stream_url
            const runningMatches = matches.filter(m => m.status === 'running');
            if (runningMatches.length > 0) {
                console.log(`🔴 Found ${runningMatches.length} LIVE matches with stream data from list endpoint`);
            }

            if (matches.length > 0) {
                await this._updateCache(matches);
            }

            return matches;
        } catch (error) {
            console.error('❌ Error fetching live matches:', error.message);
            return [];
        }
    }

    async fetchMatches() {
        try {
            console.log('🔄 Fetching FULL SCHEDULE from PandaScore...');
            let pastMatches = [];
            let futureMatches = [];

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
            for (let page = 1; page <= 2; page++) {
                const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'sort': 'begin_at',
                        'filter[status]': 'running,not_started,finished',
                        'range[begin_at]': `${nowIso},${futureIso}`,
                        'per_page': 100,
                        'page': page
                    },
                    timeout: 10000
                });

                if (response.data.length === 0) break;
                futureMatches = [...futureMatches, ...response.data];
            }
            console.log(`🔮 Fetched ${futureMatches.length} future matches`);

            // 2. Fetch Past Matches (Now -> Past)
            for (let page = 1; page <= 2; page++) {
                const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'sort': '-begin_at',
                        'filter[status]': 'running,not_started,finished',
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

            // 3. Fetch ALL Running (LIVE) Matches with detailed stream info
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
                console.log(`🔴 Fetched ${runningMatches.length} LIVE (running) matches (stream data included)`);
            } catch (error) {
                console.log('⚠️ Error fetching running matches:', error.message);
            }

            // Combine matches
            const allFetchedMatches = [...pastMatches, ...futureMatches, ...runningMatches];
            console.log(`📊 Total fetched from PandaScore: ${allFetchedMatches.length} matches`);

            return await this._updateCache(allFetchedMatches);
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
