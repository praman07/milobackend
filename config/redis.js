const Redis = require('ioredis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL;
let redis;

if (!redisUrl || redisUrl === 'your_upstash_redis_url') {
  console.log('⚠️ Redis configuration missing or using placeholder. Running matchmaking in-memory mode.');
  redis = {
    status: 'offline',
    on: () => {},
    off: () => {},
    get: async () => null,
    set: async () => null,
    del: async () => null,
    hset: async () => null,
    hgetall: async () => ({}),
    lrange: async () => [],
    lrem: async () => 0,
    rpush: async () => 0
  };
} else {
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 2) {
        // Disable endless retries to keep log output clean
        return null;
      }
      return Math.min(times * 100, 2000);
    }
  });

  redis.on('connect', () => console.log('✅ Redis Connected'));
  redis.on('error', (err) => console.error('❌ Redis Error:', err));
}

module.exports = redis;
