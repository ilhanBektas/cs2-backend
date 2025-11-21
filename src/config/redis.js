const redis = require('redis');

class RedisClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            this.client = redis.createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379'
            });

            this.client.on('error', (err) => {
                console.error('❌ Redis Client Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('✅ Redis connected');
                this.isConnected = true;
            });

            await this.client.connect();
            return this.client;
        } catch (error) {
            console.error('❌ Failed to connect to Redis:', error);
            this.isConnected = false;
            return null;
        }
    }

    async set(key, value, ttl = 30) {
        if (!this.isConnected || !this.client) {
            console.warn('⚠️ Redis not connected, skipping cache set');
            return false;
        }

        try {
            await this.client.setEx(key, ttl, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('❌ Redis SET error:', error);
            return false;
        }
    }

    async get(key) {
        if (!this.isConnected || !this.client) {
            console.warn('⚠️ Redis not connected, skipping cache get');
            return null;
        }

        try {
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('❌ Redis GET error:', error);
            return null;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
        }
    }
}

module.exports = new RedisClient();
