const redis = require('../config/redis');

/**
 * Matchmaking logic with Redis and In-Memory Fallback
 */

let localQueue = []; // Fallback for when Redis is offline
let localMatches = new Map(); // Fallback active matches tracker
let localDuoQueue = []; // Fallback for Duo queues

const findMatch = async (userId, socketId, gender, interestedIn, previousPartnerId = null, blockedUsers = []) => {
  localMatches.delete(userId); // Clear any old active match

  // Check if there is a Duo party waiting for a stranger
  const duoIndex = localDuoQueue.findIndex(d => !d.members.some(m => m.userId === userId));
  if (duoIndex !== -1) {
    const duo = localDuoQueue.splice(duoIndex, 1)[0];
    
    // Map active matches
    localMatches.set(userId, duo.members.map(m => m.userId));
    duo.members.forEach(m => {
      localMatches.set(m.userId, [userId]);
    });

    return { isDuo: true, duoToken: duo.duoToken, members: duo.members };
  }

  // Try Redis first
  const blocks = Array.isArray(blockedUsers) ? blockedUsers : [];

  try {
    const isRedisHealthy = redis.status === 'ready';
    
    if (isRedisHealthy) {
      const alreadyInQueue = await redis.get(`user:in_queue:${userId}`);
      if (alreadyInQueue) return null;

      await redis.hset(`user:metadata:${userId}`, { socketId, gender, interestedIn, previousPartnerId: previousPartnerId || '', blockedUsers: JSON.stringify(blocks), joinedAt: Date.now() });

      const potentialPartnerIds = await redis.lrange('queue:global', 0, 50);
      for (const partnerId of potentialPartnerIds) {
        const partnerData = await redis.hgetall(`user:metadata:${partnerId}`);
        // Allow self-match for testing if socketId is different
        let partnerBlocked = [];
        try { partnerBlocked = JSON.parse(partnerData.blockedUsers || '[]'); } catch(e){}
        if (
          isCompatible({ gender, interestedIn }, partnerData) && 
          !blocks.includes(partnerId) &&
          !partnerBlocked.includes(userId) &&
          (partnerId !== userId || partnerData.socketId !== socketId)
        ) {
          const removedCount = await redis.lrem('queue:global', 1, partnerId);
          if (removedCount > 0) {
            await redis.del(`user:in_queue:${userId}`);
            await redis.del(`user:in_queue:${partnerId}`);
            await redis.set(`match:active:${userId}`, partnerId, 'EX', 3600);
            await redis.set(`match:active:${partnerId}`, userId, 'EX', 3600);
            return { userId: partnerId, socketId: partnerData.socketId };
          }
        }
      }

      await redis.rpush('queue:global', userId);
      await redis.set(`user:in_queue:${userId}`, 'true', 'EX', 300);
      return null;
    }
  } catch (err) {
    console.warn('Redis Matchmaking failed, falling back to in-memory:', err.message);
  }

  // IN-MEMORY FALLBACK (Dev mode)
  const existing = localQueue.find(u => u.userId === userId && u.socketId === socketId);
  if (existing) return null;

  const matchIndex = localQueue.findIndex(q => 
    isCompatible({ gender, interestedIn }, q) && 
    !blocks.includes(q.userId) &&
    !(q.blockedUsers || []).includes(userId) &&
    (q.userId !== userId || q.socketId !== socketId)
  );
  
  if (matchIndex !== -1) {
    const match = localQueue.splice(matchIndex, 1)[0];
    localMatches.set(userId, match.userId);
    localMatches.set(match.userId, userId);
    return match;
  } else {
    localQueue.push({ userId, socketId, gender, interestedIn, previousPartnerId, blockedUsers: blocks });
    return null;
  }
};

const findMatchForDuo = async (duoToken, leaderId, members) => {
  const memberIds = members.map(m => m.userId);
  const strangerIndex = localQueue.findIndex(q => !memberIds.includes(q.userId));

  if (strangerIndex !== -1) {
    const stranger = localQueue.splice(strangerIndex, 1)[0];
    
    localMatches.set(stranger.userId, members.map(m => m.userId));
    members.forEach(m => {
      localMatches.set(m.userId, [stranger.userId]);
    });

    return stranger;
  } else {
    const existing = localDuoQueue.find(d => d.duoToken === duoToken);
    if (!existing) {
      localDuoQueue.push({ duoToken, leaderId, members });
    }
    return null;
  }
};

const cancelDuoSearch = async (duoToken) => {
  localDuoQueue = localDuoQueue.filter(d => d.duoToken !== duoToken);
};

const cancelSearch = async (userId) => {
  localQueue = localQueue.filter(u => u.userId !== userId);
  try {
    if (redis.status === 'ready') {
      await redis.lrem('queue:global', 0, userId);
      await redis.del(`user:in_queue:${userId}`);
    }
  } catch (e) {}
};

const handleDisconnect = async (userId, socketId) => {
  await cancelSearch(userId);
  localDuoQueue = localDuoQueue.filter(d => !d.members.some(m => m.userId === userId));
  
  try {
    if (redis.status === 'ready') {
      const partnerId = await redis.get(`match:active:${userId}`);
      if (partnerId) {
        await redis.del(`match:active:${userId}`);
        await redis.del(`match:active:${partnerId}`);
        return partnerId;
      }
    }
  } catch (e) {}

  // In-memory fallback match cleanup
  const partnerId = localMatches.get(userId);
  if (partnerId) {
    localMatches.delete(userId);
    if (Array.isArray(partnerId)) {
      partnerId.forEach(id => {
        localMatches.delete(id);
      });
      return partnerId;
    } else {
      localMatches.delete(partnerId);
      return partnerId;
    }
  }
  return null;
};

const isCompatible = (u1, u2) => {
  const u1Int = (u1.interestedIn || 'both').toLowerCase();
  const u2Int = (u2.interestedIn || 'both').toLowerCase();
  const u1Gen = (u1.gender || 'unknown').toLowerCase();
  const u2Gen = (u2.gender || 'unknown').toLowerCase();

  const u1Pref = (u1Int === 'both' || u1Int === 'everyone' || u1Int === 'unknown');
  const u2Pref = (u2Int === 'both' || u2Int === 'everyone' || u2Int === 'unknown');

  const u1Satisfied = u1Pref || u1Int === u2Gen;
  const u2Satisfied = u2Pref || u2Int === u1Gen;

  const res = u1Satisfied && u2Satisfied;
  console.log(`[Compatibility Check] ${u1Gen} (seeks ${u1Int}) vs ${u2Gen} (seeks ${u2Int}) => ${res ? 'COMPATIBLE' : 'INCOMPATIBLE'}`);
  return res;
};

module.exports = {
  findMatch,
  findMatchForDuo,
  cancelDuoSearch,
  cancelSearch,
  handleDisconnect
};
