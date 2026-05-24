const matchmaker = require('../utils/matchmaker');

const duoRooms = new Map(); // duoToken -> { leaderId, members: [ { userId, socketId } ] }

module.exports = (io, socket, users) => {
  // 1. Matchmaking (Requested Names)
  socket.on('find-stranger', async (userData) => {
    const { userId, gender, interestedIn, previousPartner, blockedUsers } = userData;
    socket.userId = userId; // Store on socket for easy access
    console.log(`[Queue] User ${userId} searching for stranger...`);
    
    users.set(userId, socket.id);

    try {
      const match = await matchmaker.findMatch(userId, socket.id, gender, interestedIn, previousPartner, blockedUsers);

      if (match) {
        if (match.isDuo) {
          console.log(`[Match Duo] Stranger ${userId} <-> Duo ${match.duoToken}`);
          
          io.to(socket.id).emit('matched', {
            roomId: `duo_room_${match.duoToken}`,
            partners: match.members.map(m => m.userId),
            initiator: true,
            isDuoMatch: true
          });

          match.members.forEach(m => {
            io.to(m.socketId).emit('matched', {
              roomId: `duo_room_${match.duoToken}`,
              partners: [userId],
              initiator: false,
              isDuoMatch: true
            });
          });
        } else {
          console.log(`[Match] ${userId} <-> ${match.userId}`);
          
          const matchPayload = {
            roomId: `room_${userId}_${match.userId}`,
            user1: userId,
            user2: match.userId
          };

          io.to(socket.id).emit('matched', { 
            ...matchPayload,
            partnerId: match.userId, 
            initiator: true 
          });
          
          io.to(match.socketId).emit('matched', { 
            ...matchPayload,
            partnerId: userId, 
            initiator: false 
          });
        }
      } else {
        socket.emit('searching');
      }
    } catch (err) {
      console.error('Matchmaking Error:', err);
      socket.emit('error', 'Matchmaking failed');
    }
  });

  socket.on('cancel-search', async (userId) => {
    if (userId) {
      await matchmaker.cancelSearch(userId);
      socket.emit('queue_left');
    }
  });

  // 1.5 Duo Matchmaking Events
  socket.on('join-duo', ({ duoToken, userId }) => {
    socket.duoToken = duoToken;
    socket.userId = userId;
    users.set(userId, socket.id);

    // Cancel any solo search
    matchmaker.cancelSearch(userId);

    let room = duoRooms.get(duoToken);
    if (!room) {
      room = { leaderId: userId, members: [] };
      duoRooms.set(duoToken, room);
    }

    if (!room.members.find(m => m.userId === userId)) {
      room.members.push({ userId, socketId: socket.id });
    }

    console.log(`[Duo] User ${userId} joined duo room ${duoToken}. Members count: ${room.members.length}`);

    if (room.members.length === 2) {
      const first = room.members[0];
      const second = room.members[1];
      
      io.to(first.socketId).emit('duo-ready', {
        friendId: second.userId,
        isLeader: room.leaderId === first.userId
      });
      io.to(second.socketId).emit('duo-ready', {
        friendId: first.userId,
        isLeader: room.leaderId === second.userId
      });

      // Automatically trigger connection between the two friends
      io.to(users.get(room.leaderId)).emit('connect-friend', {
        friendId: room.members.find(m => m.userId !== room.leaderId).userId,
        initiator: true
      });
      io.to(users.get(room.members.find(m => m.userId !== room.leaderId).userId)).emit('connect-friend', {
        friendId: room.leaderId,
        initiator: false
      });
    }
  });

  socket.on('leave-duo', () => {
    const userId = socket.userId;
    const duoToken = socket.duoToken;
    console.log(`[Duo] User ${userId} leaving room ${duoToken}`);
    if (userId && duoToken) {
      const room = duoRooms.get(duoToken);
      if (room) {
        room.members = room.members.filter(m => m.userId !== userId);
        if (room.members.length > 0) {
          io.to(room.members[0].socketId).emit('duo-friend-left');
        } else {
          console.log(`[Duo] Room ${duoToken} empty. Deleting room instantly.`);
          duoRooms.delete(duoToken);
        }
      }
      socket.duoToken = null;
    }
  });

  socket.on('find-stranger-duo', async ({ duoToken, userId }) => {
    console.log(`[Duo Queue] Duo party ${duoToken} searching for stranger...`);
    const room = duoRooms.get(duoToken);
    if (!room || room.members.length < 2) {
      socket.emit('error', 'Duo room not ready or friend not connected');
      return;
    }

    try {
      const match = await matchmaker.findMatchForDuo(duoToken, room.leaderId, room.members);

      if (match) {
        console.log(`[Match Duo] Duo ${duoToken} <-> Stranger ${match.userId}`);

        io.to(match.socketId).emit('matched', {
          roomId: `duo_room_${duoToken}`,
          partners: room.members.map(m => m.userId),
          initiator: true,
          isDuoMatch: true
        });

        room.members.forEach(m => {
          io.to(m.socketId).emit('matched', {
            roomId: `duo_room_${duoToken}`,
            partners: [match.userId],
            initiator: false,
            isDuoMatch: true
          });
        });
      } else {
        room.members.forEach(m => {
          io.to(m.socketId).emit('searching');
        });
      }
    } catch (err) {
      console.error('Duo Matchmaking Error:', err);
      socket.emit('error', 'Duo Matchmaking failed');
    }
  });

  socket.on('cancel-search-duo', async ({ duoToken }) => {
    await matchmaker.cancelDuoSearch(duoToken);
    const room = duoRooms.get(duoToken);
    if (room) {
      room.members.forEach(m => {
        io.to(m.socketId).emit('queue_left');
      });
    }
  });

  // 2. Signaling (WebRTC) - Kept separate as requested
  socket.on('signal', ({ to, signal }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', { from: socket.userId || 'unknown', signal });
    }
  });

  // 3. User Sync
  socket.on('sync_user', ({ userId }) => {
    if (userId) {
      socket.userId = userId;
      users.set(userId, socket.id);
      console.log(`[Sync] User ${userId} re-synced`);
    }
  });

  // 3.5 Manual Leave Chat (Next/End button)
  socket.on('leave-chat', ({ to }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('stranger-disconnected');
    }
  });

  // 3.6 Text Chat Messaging
  socket.on('chat-message', ({ to, message }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('chat-message', { from: socket.userId, message });
    }
  });

  // 3.7 Follow Requests in Chat
  socket.on('follow-request', ({ to, senderName }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('follow-request', { from: socket.userId, senderName });
    }
  });

  socket.on('follow-response', ({ to, accepted }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('follow-response', { from: socket.userId, accepted });
    }
  });

  socket.on('unfollow', ({ to }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('unfollow', { from: socket.userId });
    }
  });

  socket.on('video-flipped', ({ to, isFlipped }) => {
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('video-flipped', { from: socket.userId, isFlipped });
    }
  });

  // 4. Disconnect Logic
  socket.on('disconnect', async () => {
    const userId = socket.userId;
    if (userId) {
      const duoToken = socket.duoToken;
      if (duoToken) {
        const room = duoRooms.get(duoToken);
        if (room) {
          room.members = room.members.filter(m => m.userId !== userId);
          if (room.members.length > 0) {
            io.to(room.members[0].socketId).emit('duo-friend-left');
          } else {
            duoRooms.delete(duoToken);
          }
        }
      }

      const partnerId = await matchmaker.handleDisconnect(userId, socket.id);
      
      if (partnerId) {
        const ids = Array.isArray(partnerId) ? partnerId : [partnerId];
        ids.forEach(id => {
          const partnerSocketId = users.get(id);
          if (partnerSocketId) {
            io.to(partnerSocketId).emit('stranger-disconnected');
          }
        });
      }
      if (users.get(userId) === socket.id) {
        users.delete(userId);
      }
      console.log(`[Disconnect] Cleanup done for ${userId}`);
    }
  });
};
