const axios = require('axios');
const redisClient = require('../config/redis');

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
            let allMatches = [];

            // Filter out matches older than 7 days (Safe buffer for recent results)
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            const beginAtRange = `${cutoffDate.toISOString()},`;

            // Fetch multiple pages (up to 1000 matches)
            for (let page = 1; page <= 10; page++) {
                const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'sort': '-begin_at', // Descending (Newest/Future first)
                        'filter[status]': 'running,not_started,finished',
                        'range[begin_at]': beginAtRange,
                        'per_page': 100,
                        'page': page
                    },
                    timeout: 10000
                });

                console.log(`📄 Page ${page}: Fetched ${response.data.length} matches`);
                if (response.data.length === 0) break;
                allMatches = [...allMatches, ...response.data];
            }

            console.log(`📊 Total fetched from PandaScore: ${allMatches.length} matches`);

            const filteredMatches = allMatches.filter(match => {
                // Always include live matches regardless of date
                if (match.status === 'running') return true;

                const matchDate = new Date(match.begin_at);
                return matchDate >= cutoffDate;
            });

            // Update local cache
            this.localCache = filteredMatches;
            this.lastFetch = new Date().toISOString();

            // Update Redis cache
            const cacheData = {
                matches: filteredMatches,
                lastUpdate: this.lastFetch,
                count: filteredMatches.length
            };
            await redisClient.set(CACHE_KEY, cacheData, CACHE_TTL);

            console.log(`✅ Updated cache with ${filteredMatches.length} matches (filtered from ${allMatches.length})`);
            return cacheData;
        } catch (error) {
            console.error('❌ Error fetching matches:', error.message);
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
