const express = require('express');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uuidValidation } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Complete a ride (convert lobby to completed ride)
router.post('/complete/:lobbyId', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { totalAmount, distanceKm, durationMinutes } = req.body;

    // Check if user is the creator of the lobby
    const lobbyResult = await query(
      'SELECT * FROM lobbies WHERE id = $1 AND creator_id = $2 AND status = $3',
      [lobbyId, req.user.id, 'started']
    );

    if (lobbyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lobby not found or you are not authorized to complete it'
      });
    }

    const lobby = lobbyResult.rows[0];

    // Get all active members
    const membersResult = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND status = $2',
      [lobbyId, 'active']
    );

    if (membersResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active members in lobby'
      });
    }

    const members = membersResult.rows;
    const amountPerPerson = totalAmount / members.length;

    // Start transaction
    const client = await query.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create ride record
      const rideResult = await client.query(
        `INSERT INTO rides (lobby_id, driver_id, from_location, to_location, 
                           departure_time, completion_time, total_amount, distance_km, 
                           duration_minutes, status)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8, 'completed')
         RETURNING *`,
        [
          lobbyId,
          req.user.id,
          lobby.from_location,
          lobby.to_location,
          lobby.departure_time,
          totalAmount,
          distanceKm,
          durationMinutes
        ]
      );

      const ride = rideResult.rows[0];

      // Add ride participants
      for (const member of members) {
        await client.query(
          `INSERT INTO ride_participants (ride_id, user_id, amount_paid, 
                                         pickup_location, dropoff_location)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            ride.id,
            member.user_id,
            amountPerPerson,
            member.pickup_location,
            lobby.to_location
          ]
        );

        // Update user's total rides count
        await client.query(
          'UPDATE users SET total_rides = total_rides + 1 WHERE id = $1',
          [member.user_id]
        );
      }

      // Update lobby status
      await client.query(
        'UPDATE lobbies SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['completed', lobbyId]
      );

      await client.query('COMMIT');

      logger.info(`Ride completed: ${ride.id} from lobby ${lobbyId}`);

      res.json({
        success: true,
        message: 'Ride completed successfully',
        data: { ride }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('Complete ride error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete ride'
    });
  }
});

// Get ride details
router.get('/:id', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { id } = req.params;

    // Get ride details
    const rideResult = await query(
      `SELECT r.*, u.name as driver_name, u.avatar_url as driver_avatar, u.rating as driver_rating
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       WHERE r.id = $1`,
      [id]
    );

    if (rideResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    const ride = rideResult.rows[0];

    // Check if user was a participant
    const participantCheck = await query(
      'SELECT * FROM ride_participants WHERE ride_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You were not a participant in this ride'
      });
    }

    // Get all participants
    const participantsResult = await query(
      `SELECT rp.*, u.name, u.avatar_url, u.rating
       FROM ride_participants rp
       JOIN users u ON rp.user_id = u.id
       WHERE rp.ride_id = $1
       ORDER BY rp.created_at ASC`,
      [id]
    );

    ride.participants = participantsResult.rows;

    res.json({
      success: true,
      data: { ride }
    });
  } catch (error) {
    logger.error('Get ride error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ride details'
    });
  }
});

// Rate a ride participant
router.post('/:id/rate', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { id } = req.params;
    const { participantUserId, rating, review } = req.body;

    if (!participantUserId || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Participant user ID and rating are required'
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    // Check if user was a participant in this ride
    const userParticipantCheck = await query(
      'SELECT * FROM ride_participants WHERE ride_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (userParticipantCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You were not a participant in this ride'
      });
    }

    // Check if the participant to be rated was in this ride
    const participantCheck = await query(
      'SELECT * FROM ride_participants WHERE ride_id = $1 AND user_id = $2',
      [id, participantUserId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User was not a participant in this ride'
      });
    }

    // Check if already rated
    const existingRating = await query(
      'SELECT * FROM ride_participants WHERE ride_id = $1 AND user_id = $2 AND rating IS NOT NULL',
      [id, participantUserId]
    );

    if (existingRating.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this participant'
      });
    }

    // Update rating
    await query(
      'UPDATE ride_participants SET rating = $1, review = $2 WHERE ride_id = $3 AND user_id = $4',
      [rating, review, id, participantUserId]
    );

    // Update user's overall rating
    const ratingsResult = await query(
      'SELECT AVG(rating) as avg_rating FROM ride_participants WHERE user_id = $1 AND rating IS NOT NULL',
      [participantUserId]
    );

    const avgRating = parseFloat(ratingsResult.rows[0].avg_rating);

    await query(
      'UPDATE users SET rating = $1 WHERE id = $2',
      [avgRating, participantUserId]
    );

    logger.info(`User ${req.user.id} rated user ${participantUserId} with ${rating} stars for ride ${id}`);

    res.json({
      success: true,
      message: 'Rating submitted successfully'
    });
  } catch (error) {
    logger.error('Rate participant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit rating'
    });
  }
});

// Get user's ride history
router.get('/user/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereCondition = 'WHERE rp.user_id = $1';
    let queryParams = [req.user.id];
    let paramCount = 2;

    if (status) {
      whereCondition += ` AND r.status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }

    queryParams.push(parseInt(limit), offset);

    const result = await query(
      `SELECT r.*, rp.amount_paid, rp.pickup_location, rp.dropoff_location, 
              rp.rating as my_rating, rp.review as my_review,
              u.name as driver_name, u.avatar_url as driver_avatar
       FROM rides r
       JOIN ride_participants rp ON r.id = rp.ride_id
       JOIN users u ON r.driver_id = u.id
       ${whereCondition}
       ORDER BY r.departure_time DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM ride_participants rp
       JOIN rides r ON rp.ride_id = r.id
       ${whereCondition.replace(/\$\d+/g, (match, offset) => {
         const paramIndex = parseInt(match.substring(1));
         return paramIndex <= queryParams.length - 2 ? match : '';
       })}`,
      queryParams.slice(0, -2)
    );

    const totalRides = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRides / parseInt(limit));

    res.json({
      success: true,
      data: {
        rides: result.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalRides,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    logger.error('Get ride history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ride history'
    });
  }
});

// Get ride statistics for user
router.get('/user/stats', authenticateToken, async (req, res) => {
  try {
    const statsResult = await query(
      `SELECT 
         COUNT(*) as total_rides,
         SUM(rp.amount_paid) as total_spent,
         AVG(rp.rating) as average_rating_given,
         COUNT(CASE WHEN r.status = 'completed' THEN 1 END) as completed_rides,
         COUNT(CASE WHEN r.status = 'cancelled' THEN 1 END) as cancelled_rides
       FROM ride_participants rp
       JOIN rides r ON rp.ride_id = r.id
       WHERE rp.user_id = $1`,
      [req.user.id]
    );

    const stats = statsResult.rows[0];

    // Get user's overall rating received
    const userRatingResult = await query(
      'SELECT rating FROM users WHERE id = $1',
      [req.user.id]
    );

    const userRating = parseFloat(userRatingResult.rows[0].rating);

    res.json({
      success: true,
      data: {
        stats: {
          totalRides: parseInt(stats.total_rides),
          totalSpent: parseFloat(stats.total_spent) || 0,
          averageRatingGiven: parseFloat(stats.average_rating_given) || 0,
          completedRides: parseInt(stats.completed_rides),
          cancelledRides: parseInt(stats.cancelled_rides),
          userRating: userRating
        }
      }
    });
  } catch (error) {
    logger.error('Get ride stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ride statistics'
    });
  }
});

module.exports = router;