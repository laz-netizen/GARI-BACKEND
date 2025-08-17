const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userResult = await query(
      'SELECT id, name, email, phone FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return next(new Error('User not found'));
    }

    socket.user = userResult.rows[0];
    next();
  } catch (error) {
    logger.error('Socket authentication error:', error);
    next(new Error('Authentication error'));
  }
};

const socketHandler = (io) => {
  // Authentication middleware
  io.use(socketAuth);

  io.on('connection', (socket) => {
    logger.info(`User connected: ${socket.user.name} (${socket.user.id})`);

    // Join user to their personal room
    socket.join(`user_${socket.user.id}`);

    // Handle joining lobby rooms
    socket.on('join_lobby', async (lobbyId) => {
      try {
        // Verify user is member of this lobby
        const memberResult = await query(
          'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND status = $3',
          [lobbyId, socket.user.id, 'active']
        );

        if (memberResult.rows.length > 0) {
          socket.join(`lobby_${lobbyId}`);
          socket.emit('joined_lobby', { lobbyId });
          logger.info(`User ${socket.user.name} joined lobby ${lobbyId}`);
        } else {
          socket.emit('error', { message: 'Not authorized to join this lobby' });
        }
      } catch (error) {
        logger.error('Error joining lobby:', error);
        socket.emit('error', { message: 'Failed to join lobby' });
      }
    });

    // Handle leaving lobby rooms
    socket.on('leave_lobby', (lobbyId) => {
      socket.leave(`lobby_${lobbyId}`);
      socket.emit('left_lobby', { lobbyId });
      logger.info(`User ${socket.user.name} left lobby ${lobbyId}`);
    });

    // Handle chat messages
    socket.on('send_message', async (data) => {
      try {
        const { lobbyId, message, messageType = 'text' } = data;

        // Verify user is member of this lobby
        const memberResult = await query(
          'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND status = $3',
          [lobbyId, socket.user.id, 'active']
        );

        if (memberResult.rows.length === 0) {
          socket.emit('error', { message: 'Not authorized to send messages to this lobby' });
          return;
        }

        // Save message to database
        const messageResult = await query(
          'INSERT INTO chat_messages (lobby_id, user_id, message, message_type) VALUES ($1, $2, $3, $4) RETURNING *',
          [lobbyId, socket.user.id, message, messageType]
        );

        const newMessage = {
          id: messageResult.rows[0].id,
          lobbyId,
          userId: socket.user.id,
          userName: socket.user.name,
          message,
          messageType,
          timestamp: messageResult.rows[0].created_at
        };

        // Broadcast message to all lobby members
        io.to(`lobby_${lobbyId}`).emit('new_message', newMessage);
        
        logger.info(`Message sent in lobby ${lobbyId} by ${socket.user.name}`);
      } catch (error) {
        logger.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle location updates
    socket.on('location_update', async (data) => {
      try {
        const { lobbyId, latitude, longitude } = data;

        // Verify user is member of this lobby
        const memberResult = await query(
          'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND status = $3',
          [lobbyId, socket.user.id, 'active']
        );

        if (memberResult.rows.length === 0) {
          return;
        }

        // Broadcast location update to lobby members
        socket.to(`lobby_${lobbyId}`).emit('member_location_update', {
          userId: socket.user.id,
          userName: socket.user.name,
          latitude,
          longitude,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Error updating location:', error);
      }
    });

    // Handle lobby status updates
    socket.on('lobby_status_update', async (data) => {
      try {
        const { lobbyId, status } = data;

        // Verify user is creator of this lobby
        const lobbyResult = await query(
          'SELECT * FROM lobbies WHERE id = $1 AND creator_id = $2',
          [lobbyId, socket.user.id]
        );

        if (lobbyResult.rows.length === 0) {
          socket.emit('error', { message: 'Not authorized to update this lobby' });
          return;
        }

        // Update lobby status
        await query(
          'UPDATE lobbies SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [status, lobbyId]
        );

        // Broadcast status update to all lobby members
        io.to(`lobby_${lobbyId}`).emit('lobby_status_changed', {
          lobbyId,
          status,
          updatedBy: socket.user.name,
          timestamp: new Date()
        });

        logger.info(`Lobby ${lobbyId} status updated to ${status} by ${socket.user.name}`);
      } catch (error) {
        logger.error('Error updating lobby status:', error);
        socket.emit('error', { message: 'Failed to update lobby status' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { lobbyId } = data;
      socket.to(`lobby_${lobbyId}`).emit('user_typing', {
        userId: socket.user.id,
        userName: socket.user.name
      });
    });

    socket.on('typing_stop', (data) => {
      const { lobbyId } = data;
      socket.to(`lobby_${lobbyId}`).emit('user_stopped_typing', {
        userId: socket.user.id,
        userName: socket.user.name
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${socket.user.name} (${socket.user.id})`);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  });

  return io;
};

module.exports = socketHandler;