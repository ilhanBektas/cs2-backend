const axios = require('axios');

const PANDASCORE_API_KEY = process.env.PANDASCORE_API_KEY;
const BASE_URL = 'https://api.pandascore.co/csgo';

class TeamsService {
    constructor() {
        this.teamsCache = null;
        this.cacheExpiry = null;
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    }

    /**
     * Get all CS:GO teams with their logos
     * @returns {Promise<Array>} Array of teams with logos
     */
    async getAllTeams() {
        // Check cache first
        if (this.teamsCache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
            console.log('📦 Returning cached teams data');
            return this.teamsCache;
        }

        try {
            console.log('🔍 Fetching teams from PandaScore API...');

            // Fetch all teams (paginated)
            const allTeams = [];
            let page = 1;
            const perPage = 100;

            while (page <= 3) { // Limit to 3 pages (300 teams) to avoid rate limits
                const response = await axios.get(`${BASE_URL}/teams`, {
                    params: {
                        token: PANDASCORE_API_KEY,
                        per_page: perPage,
                        page: page,
                        sort: '-modified_at' // Get recently updated teams first
                    },
                    timeout: 10000
                });

                if (!response.data || response.data.length === 0) {
                    break; // No more teams
                }

                allTeams.push(...response.data);
                page++;

                // Add delay between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Extract team names and logos
            const teamsWithLogos = allTeams
                .filter(team => team.image_url) // Only teams with logos
                .map(team => ({
                    id: team.id,
                    name: team.name,
                    acronym: team.acronym,
                    logo: team.image_url
                }));

            console.log(`✅ Fetched ${teamsWithLogos.length} teams with logos`);

            // Update cache
            this.teamsCache = teamsWithLogos;
            this.cacheExpiry = Date.now() + this.CACHE_DURATION;

            return teamsWithLogos;
        } catch (error) {
            console.error('❌ Error fetching teams:', error.message);

            // Return cached data if available, even if expired
            if (this.teamsCache) {
                console.log('⚠️ Returning expired cache due to error');
                return this.teamsCache;
            }

            throw error;
        }
    }

    /**
     * Get team logos as a simple map
     * @returns {Promise<Object>} Map of team names to logo URLs
     */
    async getTeamLogos() {
        const teams = await this.getAllTeams();

        const logoMap = {};
        teams.forEach(team => {
            logoMap[team.name] = team.logo;
            // Also add by acronym if available
            if (team.acronym) {
                logoMap[team.acronym] = team.logo;
            }
        });

        return logoMap;
    }
}

module.exports = new TeamsService();
