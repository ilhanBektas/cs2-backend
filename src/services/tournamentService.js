const axios = require('axios');
const redisClient = require('../config/redis');

const API_KEY = process.env.PANDASCORE_API_KEY;
const BASE_URL = 'https://api.pandascore.co';
const TOURNAMENTS_CACHE_KEY = 'cs2:tournaments';
const STANDINGS_CACHE_KEY = 'cs2:standings:';
const CACHE_TTL = 1800; // 30 minutes

class TournamentService {
    constructor() {
        this.localTournamentsCache = [];
        this.lastTournamentsFetch = null;
    }

    /**
     * Fetch active and upcoming CS2 tournaments
     */
    async fetchTournaments() {
        try {
            console.log('🏆 Fetching CS2 tournaments...');

            const now = new Date();
            const futureDate = new Date();
            futureDate.setMonth(futureDate.getMonth() + 2); // Next 2 months

            // Fetch running and upcoming tournaments
            const response = await axios.get(`${BASE_URL}/csgo/tournaments`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                params: {
                    'filter[running]': 'true,false',
                    'range[begin_at]': `${now.toISOString()},${futureDate.toISOString()}`,
                    'sort': 'begin_at',
                    'per_page': 20
                },
                timeout: 10000
            });

            const tournaments = response.data || [];

            // Filter to show only major tournaments (tier: a, b, or has prize pool)
            const majorTournaments = tournaments.filter(t => {
                const hasPrizePool = t.prizepool && parseInt(t.prizepool) > 10000;
                const isMajorTier = t.tier && ['a', 'b', 's'].includes(t.tier.toLowerCase());
                return hasPrizePool || isMajorTier;
            });

            console.log(`✅ Fetched ${majorTournaments.length} major tournaments`);

            // Cache tournaments
            this.localTournamentsCache = majorTournaments;
            this.lastTournamentsFetch = new Date().toISOString();

            const cacheData = {
                tournaments: majorTournaments,
                lastUpdate: this.lastTournamentsFetch,
                count: majorTournaments.length
            };

            await redisClient.set(TOURNAMENTS_CACHE_KEY, cacheData, CACHE_TTL);

            return cacheData;
        } catch (error) {
            console.error('❌ Error fetching tournaments:', error.message);
            if (error.response) {
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            return null;
        }
    }

    /**
     * Get tournaments (from cache or fetch fresh)
     */
    async getTournaments() {
        // Try Redis first
        const cached = await redisClient.get(TOURNAMENTS_CACHE_KEY);
        if (cached) {
            console.log('📦 Serving tournaments from Redis cache');
            return cached;
        }

        // Fallback to local cache
        if (this.localTournamentsCache.length > 0) {
            console.log('💾 Serving tournaments from local cache');
            return {
                tournaments: this.localTournamentsCache,
                lastUpdate: this.lastTournamentsFetch,
                count: this.localTournamentsCache.length
            };
        }

        // No cache, fetch fresh
        console.log('🆕 No cache available, fetching fresh tournaments');
        return await this.fetchTournaments();
    }

    /**
     * Fetch standings for a specific tournament
     */
    async fetchTournamentStandings(tournamentId) {
        try {
            console.log(`🏆 Fetching standings for tournament ${tournamentId}...`);

            // Get tournament details first
            const tournamentResponse = await axios.get(`${BASE_URL}/csgo/tournaments/${tournamentId}`, {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            const tournament = tournamentResponse.data;

            // Try to get standings (may not be available for all tournaments)
            let standings = [];
            try {
                const standingsResponse = await axios.get(`${BASE_URL}/tournaments/${tournamentId}/standings`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                });
                standings = standingsResponse.data || [];
            } catch (standingsError) {
                console.log(`⚠️ Standings not available for tournament ${tournamentId}`);
            }

            // Get tournament matches for additional context
            let matches = [];
            try {
                const matchesResponse = await axios.get(`${BASE_URL}/csgo/matches`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        'filter[tournament_id]': tournamentId,
                        'sort': '-begin_at',
                        'per_page': 50
                    },
                    timeout: 10000
                });
                matches = matchesResponse.data || [];
            } catch (matchesError) {
                console.log(`⚠️ Could not fetch matches for tournament ${tournamentId}`);
            }

            // Calculate team standings from matches if standings endpoint doesn't work
            if (standings.length === 0 && matches.length > 0) {
                standings = this.calculateStandingsFromMatches(matches);
            }

            const result = {
                tournament,
                standings,
                matches,
                lastUpdate: new Date().toISOString()
            };

            // Cache standings
            await redisClient.set(`${STANDINGS_CACHE_KEY}${tournamentId}`, result, CACHE_TTL);

            console.log(`✅ Fetched standings for tournament ${tournamentId}`);
            return result;
        } catch (error) {
            console.error(`❌ Error fetching tournament standings:`, error.message);
            if (error.response) {
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Calculate standings from match results
     */
    calculateStandingsFromMatches(matches) {
        const teamStats = {};

        matches.forEach(match => {
            if (match.status !== 'finished') return;

            const team1 = match.opponents?.[0]?.opponent;
            const team2 = match.opponents?.[1]?.opponent;
            const score1 = match.results?.[0]?.score || 0;
            const score2 = match.results?.[1]?.score || 0;

            if (!team1 || !team2) return;

            // Initialize team stats
            if (!teamStats[team1.id]) {
                teamStats[team1.id] = {
                    team: team1,
                    wins: 0,
                    losses: 0,
                    points: 0,
                    matchesPlayed: 0
                };
            }
            if (!teamStats[team2.id]) {
                teamStats[team2.id] = {
                    team: team2,
                    wins: 0,
                    losses: 0,
                    points: 0,
                    matchesPlayed: 0
                };
            }

            // Update stats
            teamStats[team1.id].matchesPlayed++;
            teamStats[team2.id].matchesPlayed++;

            if (score1 > score2) {
                teamStats[team1.id].wins++;
                teamStats[team1.id].points += 3;
                teamStats[team2.id].losses++;
            } else if (score2 > score1) {
                teamStats[team2.id].wins++;
                teamStats[team2.id].points += 3;
                teamStats[team1.id].losses++;
            } else {
                // Draw (rare in CS2 but possible)
                teamStats[team1.id].points += 1;
                teamStats[team2.id].points += 1;
            }
        });

        // Convert to array and sort by points
        const standings = Object.values(teamStats)
            .sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                return b.wins - a.wins;
            })
            .map((stats, index) => ({
                rank: index + 1,
                ...stats
            }));

        return standings;
    }

    /**
     * Get tournament standings (from cache or fetch fresh)
     */
    async getStandings(tournamentId) {
        const cacheKey = `${STANDINGS_CACHE_KEY}${tournamentId}`;

        // Try Redis cache
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            console.log(`📦 Serving standings for tournament ${tournamentId} from cache`);
            return cached;
        }

        // Fetch fresh
        return await this.fetchTournamentStandings(tournamentId);
    }
}

module.exports = new TournamentService();
