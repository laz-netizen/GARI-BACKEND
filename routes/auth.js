const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { registerValidation, loginValidation } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Register
router.post('/register', registerValidation, async (req, res) => {
  try {
    const { name, email, phone, password, avatarUrl } = req.body;

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await query(
      `INSERT INTO users (name, email, phone, password_hash, avatar_url) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, email, phone, avatar_url, is_verified, total_rides, member_since`,
      [name, email, phone, passwordHash, avatarUrl]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Save session
    await query(
      'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, await bcrypt.hash(token, 10), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    logger.info(`New user registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar_url,
          isVerified: user.is_verified,
          totalRides: user.total_rides,
          memberSince: user.member_since
        },
        token
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// Login
router.post('/login', loginValidation, async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Find user by phone
    const result = await query(
      'SELECT id, name, email, phone, password_hash, avatar_url, is_verified, total_rides, member_since, is_active FROM users WHERE phone = $1',
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Save session
    await query(
      'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, await bcrypt.hash(token, 10), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    // Update last active
    await query(
      'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    logger.info(`User logged in: ${user.email}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar_url,
          isVerified: user.is_verified,
          totalRides: user.total_rides,
          memberSince: user.member_since
        },
        token
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // Remove session
    await query(
      'DELETE FROM user_sessions WHERE user_id = $1 AND token_hash = $2',
      [req.user.id, await bcrypt.hash(token, 10)]
    );

    logger.info(`User logged out: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, email, phone, avatar_url, is_verified, total_rides, rating, member_since FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar_url,
          isVerified: user.is_verified,
          totalRides: user.total_rides,
          rating: parseFloat(user.rating),
          memberSince: user.member_since
        }
      }
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user data'
    });
  }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    // Generate new token
    const token = jwt.sign(
      { userId: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Update session
    await query(
      'UPDATE user_sessions SET token_hash = $1, expires_at = $2 WHERE user_id = $3',
      [await bcrypt.hash(token, 10), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), req.user.id]
    );

    res.json({
      success: true,
      data: { token }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
});

module.exports = router;