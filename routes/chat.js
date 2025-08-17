const express = require('express');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sendMessageValidation, uuidValidation } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Get chat messages for a lobby
router.get('/lobby/:lobbyId', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check if user is a member of the lobby
    const memberCheck = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2',
      [lobbyId, req.user.id]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this lobby'
      });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT cm.*, u.name as user_name, u.avatar_url as user_avatar
       FROM chat_messages cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.lobby_id = $1
       ORDER BY cm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [lobbyId, parseInt(limit), offset]
    );

    // Get total message count
    const countResult = await query(
      'SELECT COUNT(*) FROM chat_messages WHERE lobby_id = $1',
      [lobbyId]
    );

    const totalMessages = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalMessages / parseInt(limit));

    res.json({
      success: true,
      data: {
        messages: result.rows.reverse(), // Reverse to show oldest first
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalMessages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    logger.error('Get chat messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat messages'
    });
  }
});

// Send message to lobby (REST endpoint - Socket.IO is preferred)
router.post('/lobby/:lobbyId/message', 
  authenticateToken, 
  uuidValidation, 
  sendMessageValidation, 
  async (req, res) => {
    try {
      const { lobbyId } = req.params;
      const { message, messageType = 'text' } = req.body;

      // Check if user is a member of the lobby
      const memberCheck = await query(
        'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND status = $3',
        [lobbyId, req.user.id, 'active']
      );

      if (memberCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not an active member of this lobby'
        });
      }

      // Save message to database
      const result = await query(
        'INSERT INTO chat_messages (lobby_id, user_id, message, message_type) VALUES ($1, $2, $3, $4) RETURNING *',
        [lobbyId, req.user.id, message, messageType]
      );

      const newMessage = result.rows[0];

      // Get user info for the response
      const userResult = await query(
        'SELECT name, avatar_url FROM users WHERE id = $1',
        [req.user.id]
      );

      const user = userResult.rows[0];

      const messageResponse = {
        id: newMessage.id,
        lobbyId: newMessage.lobby_id,
        userId: newMessage.user_id,
        userName: user.name,
        userAvatar: user.avatar_url,
        message: newMessage.message,
        messageType: newMessage.message_type,
        timestamp: newMessage.created_at
      };

      logger.info(`Message sent to lobby ${lobbyId} by user ${req.user.id}`);

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: { message: messageResponse }
      });
    } catch (error) {
      logger.error('Send message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message'
      });
    }
  }
);

// Delete message
router.delete('/message/:messageId', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { messageId } = req.params;

    // Check if message exists and user owns it
    const messageResult = await query(
      'SELECT * FROM chat_messages WHERE id = $1 AND user_id = $2',
      [messageId, req.user.id]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found or you do not have permission to delete it'
      });
    }

    // Delete message
    await query(
      'DELETE FROM chat_messages WHERE id = $1',
      [messageId]
    );

    logger.info(`Message ${messageId} deleted by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    logger.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
});

// Get lobby chat summary
router.get('/lobby/:lobbyId/summary', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { lobbyId } = req.params;

    // Check if user is a member of the lobby
    const memberCheck = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2',
      [lobbyId, req.user.id]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this lobby'
      });
    }

    // Get chat statistics
    const statsResult = await query(
      `SELECT 
         COUNT(*) as total_messages,
         COUNT(DISTINCT user_id) as active_participants,
         MAX(created_at) as last_message_time,
         MIN(created_at) as first_message_time
       FROM chat_messages 
       WHERE lobby_id = $1`,
      [lobbyId]
    );

    // Get most recent messages
    const recentMessages = await query(
      `SELECT cm.message, cm.created_at, u.name as user_name
       FROM chat_messages cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.lobby_id = $1
       ORDER BY cm.created_at DESC
       LIMIT 5`,
      [lobbyId]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        summary: {
          totalMessages: parseInt(stats.total_messages),
          activeParticipants: parseInt(stats.active_participants),
          lastMessageTime: stats.last_message_time,
          firstMessageTime: stats.first_message_time
        },
        recentMessages: recentMessages.rows
      }
    });
  } catch (error) {
    logger.error('Get chat summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat summary'
    });
  }
});

module.exports = router;