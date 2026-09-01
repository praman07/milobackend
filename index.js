const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const socketHandler = require('./sockets');

const session = require('express-session');
const passport = require('./config/passport');
const jwt = require('jsonwebtoken');

const app = express();

// Session & Passport Initialization
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev_session_secret_123',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Strict CORS — only allow known origins

// Strict CORS — only allow known origins
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Always allow localhost in development
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, health checks)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50kb' })); // Limit body size to prevent DoS

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Limit payload sizes to prevent DoS via oversized socket messages
  maxHttpBufferSize: 1e5, // 100 KB
  pingTimeout: 30000,
  pingInterval: 25000,
});

// Socket.IO middleware — validate that the connecting client provides a userId
io.use((socket, next) => {
  const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
  if (!userId || typeof userId !== 'string' || userId.length > 128) {
    return next(new Error('Unauthorized: missing or invalid userId'));
  }
  // Attach to socket for downstream use
  socket.data.userId = userId;
  next();
});

// User mapping (userId -> socketId)
const users = new Map();

io.on('connection', (socket) => {
  socketHandler(io, socket, users);
});

// Health check — no sensitive data exposed
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Google OAuth routes
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get(
  '/api/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.CLIENT_URL || 'http://localhost:3000'}/login?code=auth_denied` }),
  (req, res) => {
    const token = jwt.sign(
      { user: req.user },
      process.env.JWT_SECRET || 'dev_jwt_secret_123',
      { expiresIn: '7d' }
    );
    res.cookie('token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    res.redirect(`${clientUrl}/auth/success?token=${token}&userId=${req.user.id}`);
  }
);

// Generic error handler — no stack traces in response
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
