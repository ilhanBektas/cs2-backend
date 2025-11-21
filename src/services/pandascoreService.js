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

            for (let page = 1; page <= 3; page++) {
                const response = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'sort': 'begin_at',
                        'filter[status]': 'running,not_started',
                        'per_page': 100,
                        'page': page
                    },
                    timeout: 10000
                });

                if (response.data.length === 0) break;
                allMatches = [...allMatches, ...response.data];
            }

            // Filter out matches before Nov 21, 2025
            const cutoffDate = new Date('2025-11-21T00:00:00Z');
            const filteredMatches = allMatches.filter(match => {
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
