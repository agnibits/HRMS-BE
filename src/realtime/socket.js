import { Server } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Socket.io server for real-time features (in-app notifications, presence,
 * live approvals). Each authenticated socket joins a personal room `user:<id>`
 * and a company room `company:<id>` so services can target recipients.
 */
let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.cors.origins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = verifyAccessToken(token);
      socket.user = { id: payload.sub, companyId: payload.companyId };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const { id, companyId } = socket.user;
    socket.join(`user:${id}`);
    if (companyId) socket.join(`company:${companyId}`);
    logger.debug({ userId: id }, 'socket connected');

    socket.on('disconnect', () => logger.debug({ userId: id }, 'socket disconnected'));
  });

  logger.info('✅ Socket.io initialized');
  return io;
}

export function getIo() {
  return io;
}

/** Emit an event to a specific user across all their devices. */
export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Emit an event to everyone in a company. */
export function emitToCompany(companyId, event, payload) {
  io?.to(`company:${companyId}`).emit(event, payload);
}

export default { initSocket, getIo, emitToUser, emitToCompany };
