const express = require('express');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { createLobbyValidation, uuidValidation } = require('../middleware/validation');
const mapboxService = require('../services/mapboxService');
const logger = require('../utils/logger');

const router = express.Router();

// Create lobby
router.post('/', authenticateToken, createLobbyValidation, async (req, res) => {
  try {
    const {
      fromLocation,
      toLocation,
      departureTime,
      vehicleType,
      availableSeats,
      pricePerSeat,
      description
    } = req.body;

    // Geocode locations to get coordinates
    const fromCoords = await mapboxService.geocodeAddress(fromLocation);
    const toCoords = await mapboxService.geocodeAddress(toLocation);

    if (!fromCoords || !toCoords) {
      return res.status(400).json({
        success: false,
        message: 'Could not find coordinates for the provided locations'
      });
    }

    // Create lobby
    const result = await query(
      `INSERT INTO lobbies (creator_id, from_location, to_location, from_coordinates, 
                           to_coordinates, departure_time, vehicle_type, available_seats, 
                           price_per_seat, description)
       VALUES ($1, $2, $3, POINT($4, $5), POINT($6, $7), $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.user.id,
        fromLocation,
        toLocation,
        fromCoords[0].coordinates[0], // longitude
        fromCoords[0].coordinates[1], // latitude
        toCoords[0].coordinates[0],
        toCoords[0].coordinates[1],
        departureTime,
        vehicleType,
        availableSeats,
        pricePerSeat,
        description
      ]
    );

    const lobby = result.rows[0];

    // Add creator as first member
    await query(
      'INSERT INTO lobby_members (lobby_id, user_id, pickup_location) VALUES ($1, $2, $3)',
      [lobby.id, req.user.id, fromLocation]
    );

    logger.info(`Lobby created: ${lobby.id} by user ${req.user.id}`);

    res.status(201).json({
      success: true,
      message: 'Lobby created successfully',
      data: { lobby }
    });
  } catch (error) {
    logger.error('Create lobby error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create lobby'
    });
  }
});

// Get lobbies with filters
router.get('/', async (req, res) => {
  try {
    const {
      fromLocation,
      toLocation,
      departureDate,
      maxPrice,
      minSeats,
      vehicleType,
      page = 1,
      limit = 10
    } = req.query;

    let whereConditions = ['l.status = $1'];
    let queryParams = ['active'];
    let paramCount = 2;

    if (fromLocation) {
      whereConditions.push(`l.from_location ILIKE $${paramCount}`);
      queryParams.push(`%${fromLocation}%`);
      paramCount++;
    }

    if (toLocation) {
      whereConditions.push(`l.to_location ILIKE $${paramCount}`);
      queryParams.push(`%${toLocation}%`);
      paramCount++;
    }

    if (departureDate) {
      whereConditions.push(`DATE(l.departure_time) = $${paramCount}`);
      queryParams.push(departureDate);
      paramCount++;
    }

    if (maxPrice) {
      whereConditions.push(`l.price_per_seat <= $${paramCount}`);
      queryParams.push(parseFloat(maxPrice));
      paramCount++;
    }

    if (minSeats) {
      whereConditions.push(`l.available_seats >= $${paramCount}`);
      queryParams.push(parseInt(minSeats));
      paramCount++;
    }

    if (vehicleType) {
      whereConditions.push(`l.vehicle_type = $${paramCount}`);
      queryParams.push(vehicleType);
      paramCount++;
    }

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const lobbiesQuery = `
      SELECT l.*, u.name as creator_name, u.avatar_url as creator_avatar,
             u.rating as creator_rating,
             (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id AND lm.status = 'active') as member_count
      FROM lobbies l
      JOIN users u ON l.creator_id = u.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY l.departure_time ASC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const result = await query(lobbiesQuery, queryParams);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) FROM lobbies l
      WHERE ${whereConditions.join(' AND ')}
    `;
    const countResult = await query(countQuery, queryParams.slice(0, -2));
    const totalLobbies = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalLobbies / parseInt(limit));

    res.json({
      success: true,
      data: {
        lobbies: result.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalLobbies,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    logger.error('Get lobbies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get lobbies'
    });
  }
});

// Get lobby by ID
router.get('/:id', uuidValidation, async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, u.name as creator_name, u.avatar_url as creator_avatar,
              u.rating as creator_rating, u.phone as creator_phone
       FROM lobbies l
       JOIN users u ON l.creator_id = u.id
       WHERE l.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lobby not found'
      });
    }

    const lobby = result.rows[0];

    // Get lobby members
    const membersResult = await query(
      `SELECT lm.*, u.name, u.avatar_url, u.rating
       FROM lobby_members lm
       JOIN users u ON lm.user_id = u.id
       WHERE lm.lobby_id = $1 AND lm.status = 'active'
       ORDER BY lm.joined_at ASC`,
      [req.params.id]
    );

    lobby.members = membersResult.rows;

    res.json({
      success: true,
      data: { lobby }
    });
  } catch (error) {
    logger.error('Get lobby error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get lobby'
    });
  }
});

// Join lobby
router.post('/:id/join', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { pickupLocation } = req.body;
    const lobbyId = req.params.id;

    // Check if lobby exists and is active
    const lobbyResult = await query(
      'SELECT * FROM lobbies WHERE id = $1 AND status = $2',
      [lobbyId, 'active']
    );

    if (lobbyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lobby not found or not active'
      });
    }

    const lobby = lobbyResult.rows[0];

    // Check if user is already a member
    const existingMember = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2',
      [lobbyId, req.user.id]
    );

    if (existingMember.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this lobby'
      });
    }

    // Check if lobby has available seats
    const memberCount = await query(
      'SELECT COUNT(*) FROM lobby_members WHERE lobby_id = $1 AND status = $2',
      [lobbyId, 'active']
    );

    if (parseInt(memberCount.rows[0].count) >= lobby.available_seats) {
      return res.status(400).json({
        success: false,
        message: 'Lobby is full'
      });
    }

    // Add user to lobby
    await query(
      'INSERT INTO lobby_members (lobby_id, user_id, pickup_location) VALUES ($1, $2, $3)',
      [lobbyId, req.user.id, pickupLocation || lobby.from_location]
    );

    logger.info(`User ${req.user.id} joined lobby ${lobbyId}`);

    res.json({
      success: true,
      message: 'Successfully joined lobby'
    });
  } catch (error) {
    logger.error('Join lobby error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join lobby'
    });
  }
});

// Leave lobby
router.post('/:id/leave', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const lobbyId = req.params.id;

    // Check if user is a member
    const memberResult = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND status = $3',
      [lobbyId, req.user.id, 'active']
    );

    if (memberResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this lobby'
      });
    }

    // Remove user from lobby
    await query(
      'UPDATE lobby_members SET status = $1 WHERE lobby_id = $2 AND user_id = $3',
      ['left', lobbyId, req.user.id]
    );

    // Check if user was the creator
    const lobbyResult = await query(
      'SELECT creator_id FROM lobbies WHERE id = $1',
      [lobbyId]
    );

    if (lobbyResult.rows[0].creator_id === req.user.id) {
      // If creator left, close the lobby
      await query(
        'UPDATE lobbies SET status = $1 WHERE id = $2',
        ['cancelled', lobbyId]
      );
    }

    logger.info(`User ${req.user.id} left lobby ${lobbyId}`);

    res.json({
      success: true,
      message: 'Successfully left lobby'
    });
  } catch (error) {
    logger.error('Leave lobby error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave lobby'
    });
  }
});

// Update lobby status
router.put('/:id/status', authenticateToken, uuidValidation, async (req, res) => {
  try {
    const { status } = req.body;
    const lobbyId = req.params.id;

    if (!['active', 'started', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // Check if user is the creator
    const lobbyResult = await query(
      'SELECT creator_id FROM lobbies WHERE id = $1',
      [lobbyId]
    );

    if (lobbyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lobby not found'
      });
    }

    if (lobbyResult.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Only lobby creator can update status'
      });
    }

    // Update lobby status
    await query(
      'UPDATE lobbies SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, lobbyId]
    );

    logger.info(`Lobby ${lobbyId} status updated to ${status} by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Lobby status updated successfully'
    });
  } catch (error) {
    logger.error('Update lobby status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update lobby status'
    });
  }
});

// Get user's lobbies
router.get('/user/my-lobbies', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, 
              (SELECT COUNT(*) FROM lobby_members lm WHERE lm.lobby_id = l.id AND lm.status = 'active') as member_count
       FROM lobbies l
       WHERE l.creator_id = $1
       ORDER BY l.created_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: { lobbies: result.rows }
    });
  } catch (error) {
    logger.error('Get user lobbies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user lobbies'
    });
  }
});

module.exports = router;