import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import env from './config/env';
import { connectDatabase } from './config/database';
import logger from './utils/logger';
import routes from './routes';
import { errorHandler, notFound } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';

const app: Application = express();
const httpServer = createServer(app);

// Socket.io setup
const io = new SocketServer(httpServer, {
  cors: {
    origin: [env.CLIENT_WEB_URL, env.CLIENT_MOBILE_URL],
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: [env.CLIENT_WEB_URL, env.CLIENT_MOBILE_URL],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Rate limiting
app.use(rateLimiter);

// Make io accessible to routes
app.set('io', io);

// API routes
app.use(`/api/${env.API_VERSION}`, routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('join', (userId: string) => {
    socket.join(`user:${userId}`);
    logger.info(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = parseInt(env.PORT);

const startServer = async (): Promise<void> => {
  try {
    // Connect to database
    await connectDatabase();

    // Start server
    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`
╔════════════════════════════════════════════╗
║                                            ║
║   🚀 EngiRent Hub API Server Started      ║
║                                            ║
║   Environment: ${env.NODE_ENV.padEnd(28)}║
║   Port: ${PORT.toString().padEnd(35)}║
║   API Version: ${env.API_VERSION.padEnd(28)}║
║                                            ║
║   📡 Server: http://localhost:${PORT}       ║
║   📚 API: http://localhost:${PORT}/api/${env.API_VERSION}  ║
║   ❤️  Health: http://localhost:${PORT}/api/${env.API_VERSION}/health ║
║                                            ║
╚════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    logger.info('HTTP server closed');
  });
});

startServer();

export { app, io };
