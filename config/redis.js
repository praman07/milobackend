const Redis = require('ioredis');

// Dummy in-memory stub — used when Redis is unavailable
const dummyRedis = {
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
  rpush: async () => 0,
};

const redisUrl = process.env.REDIS_URL;
const isLocalhost = !redisUrl || /localhost|127\.0\.0\.1|::1/.test(redisUrl);

// Skip Redis entirely if no URL configured or if it points to localhost
// (localhost Redis never works on cloud hosts like Render)
if (isLocalhost) {
  console.log('⚠️  No external Redis URL — matchmaking running in-memory mode.');
  module.exports = dummyRedis;
} else {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true, // Don't connect until first command
    retryStrategy(times) {
      if (times > 3) {
        // Give up after 3 retries and fall back silently
        return null;
      }
      return Math.min(times * 500, 3000);
    },
  });

  redis.on('connect', () => console.log('✅ Redis connected'));
  redis.on('error', (err) => {
    // Only log the first error — not every reconnection attempt
    if (redis.status !== 'offline_logged') {
      console.warn('⚠️  Redis unavailable, matchmaking falling back to in-memory:', err.code || err.message);
      redis.status = 'offline_logged';
    }
  });

  // After the connection fails permanently, swap to in-memory stub
  redis.on('close', () => {
    if (!redis._connected) {
      redis.status = 'offline';
    }
  });

  redis.connect().catch(() => {
    // Connection failed on startup — will be caught by retryStrategy and error handler
  });

  module.exports = redis;
}
