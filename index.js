const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    origin: ["https://milo-frontend.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"], // Add your actual Vercel URL here
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Deep Engine Logging
io.engine.on("connection_error", (err) => {
  console.log(`[Engine Error] Code ${err.code}: ${err.message}`);
  console.log(`[Engine Error] Context:`, err.context);
});

// Matchmaking Queue
let queue = []; // Array of { socketId, userId, gender, interestedIn }
const users = new Map(); // userId -> socketId mapping
const socketToUser = new Map(); // socketId -> userId mapping
const activeMatches = new Map(); // userId -> partnerUserId mapping

io.on('connection', (socket) => {
  console.log('>>> New Connection:', socket.id, 'at', new Date().toLocaleTimeString());

  socket.on('join_queue', (userData) => {
    const { userId, gender, interestedIn } = userData;
    users.set(userId, socket.id);
    socketToUser.set(socket.id, userId);
    console.log(`[Queue] User ${userId} joined. Gender: ${gender}, Interested In: ${interestedIn}`);
    
    // Check for existing match
    const match = findMatch(userData, queue);

    if (match) {
      console.log(`[Match] SUCCESS: ${socket.id} <-> ${match.socketId}`);
      
      // Track match by User ID (persistent across socket drops)
      activeMatches.set(userId, match.userId);
      activeMatches.set(match.userId, userId);

      // Remove match from queue
      queue = queue.filter(u => u.socketId !== match.socketId);
      
      // Notify both users
      io.to(socket.id).emit('matched', { 
        partnerId: match.userId, 
        initiator: true 
      });
      io.to(match.socketId).emit('matched', { 
        partnerId: userId, 
        initiator: false 
      });
    } else {
      // Add to queue if not already there
      if (!queue.find(u => u.socketId === socket.id)) {
        console.log(`[Queue] No match found. Adding to queue.`);
        queue.push({ socketId: socket.id, userId, gender, interestedIn });
        socket.emit('searching');
      }
    }
  });

  socket.on('sync_user', ({ userId }) => {
    if (userId) {
      users.set(userId, socket.id);
      socketToUser.set(socket.id, userId);
      console.log(`[Sync] User ${userId} re-synced to socket ${socket.id}`);
    }
  });

  socket.on('signal', ({ to, signal }) => {
    const targetSocketId = users.get(to);
    const fromUserId = socketToUser.get(socket.id);
    if (targetSocketId && fromUserId) {
      io.to(targetSocketId).emit('signal', { from: fromUserId, signal });
    }
  });

  socket.on('leave_queue', () => {
    queue = queue.filter(u => u.socketId !== socket.id);
    socket.emit('queue_left');
  });

  socket.on('skip', (pId) => {
    const userId = socketToUser.get(socket.id);
    const partnerUserId = activeMatches.get(userId);
    
    console.log(`[Action] Skip: ${userId} skipped ${partnerUserId || pId}`);
    
    if (partnerUserId) {
      const partnerSocketId = users.get(partnerUserId);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('partner_disconnected');
      }
      activeMatches.delete(userId);
      activeMatches.delete(partnerUserId);
    }
  });

  socket.on('disconnect', (reason) => {
    const userId = socketToUser.get(socket.id);
    console.log(`>>> Disconnected: ${socket.id} (User: ${userId || 'unknown'}) Reason: ${reason}`);
    
    // Notify partner if in match
    const partnerUserId = activeMatches.get(userId);
    if (partnerUserId) {
      console.log(`Socket: User ${userId} disconnected. Waiting 5s for potential re-sync before notifying partner ${partnerUserId}`);
      
      // Wait 5 seconds before notifying partner to allow for brief reconnection/sync
      setTimeout(() => {
        const stillInMatch = activeMatches.get(userId) === partnerUserId;
        const socketIdNow = users.get(userId);
        
        if (stillInMatch && !socketIdNow) {
          console.log(`Socket: Cleanup for ${userId} proceeding. Notifying partner ${partnerUserId}`);
          const partnerSocketId = users.get(partnerUserId);
          if (partnerSocketId) {
            io.to(partnerSocketId).emit('partner_disconnected');
          }
          activeMatches.delete(userId);
          activeMatches.delete(partnerUserId);
        } else {
          console.log(`Socket: User ${userId} re-synced successfully. Match preserved.`);
        }
      }, 5000);
    }

    if (userId) {
      users.delete(userId);
      socketToUser.delete(socket.id);
    }
    queue = queue.filter(u => u.socketId !== socket.id);
  });
});

function findMatch(user, queue) {
  console.log(`findMatch: Looking for match for user ${user.userId} (${user.gender}) interested in: ${user.interestedIn}`);
  
  return queue.find(q => {
    const userPref = (user.interestedIn === 'both' || user.interestedIn === 'everyone');
    const partnerPref = (q.interestedIn === 'both' || q.interestedIn === 'everyone');

    const genderMatch = userPref || user.interestedIn === q.gender;
    const partnerPreferenceMatch = partnerPref || q.interestedIn === user.gender;
    
    const isMatch = q.socketId !== user.socketId; // Match anyone!
    console.log(`  Checking against ${q.userId} (${q.gender}) wants ${q.interestedIn}: genderMatch=${genderMatch}, partnerPrefMatch=${partnerPreferenceMatch}, result=${isMatch}`);
    
    return isMatch;
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  
  // Server Heartbeat Log
  setInterval(() => {
    console.log(`[Pulse] Server alive. Active Users: ${users.size}, Active Matches: ${activeMatches.size/2}`);
  }, 30000);
});
