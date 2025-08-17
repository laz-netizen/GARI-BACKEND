const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/avatars/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, email, phone, avatar_url, is_verified, total_rides, rating, 
              member_since, last_active 
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

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
          memberSince: user.member_since,
          lastActive: user.last_active
        }
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// Update user profile
router.put('/profile', 
  authenticateToken,
  [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().isMobilePhone(),
    body('avatar').optional().isURL(),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { name, email, phone, avatar } = req.body;
      const updates = {};
      const values = [];
      let paramCount = 1;

      if (name) {
        updates.name = `name = $${paramCount}`;
        values.push(name);
        paramCount++;
      }

      if (email) {
        // Check if email is already taken by another user
        const emailCheck = await query(
          'SELECT id FROM users WHERE email = $1 AND id != $2',
          [email, req.user.id]
        );

        if (emailCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Email is already taken'
          });
        }

        updates.email = `email = $${paramCount}`;
        values.push(email);
        paramCount++;
      }

      if (phone) {
        // Check if phone is already taken by another user
        const phoneCheck = await query(
          'SELECT id FROM users WHERE phone = $1 AND id != $2',
          [phone, req.user.id]
        );

        if (phoneCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Phone number is already taken'
          });
        }

        updates.phone = `phone = $${paramCount}`;
        values.push(phone);
        paramCount++;
      }

      if (avatar) {
        updates.avatar_url = `avatar_url = $${paramCount}`;
        values.push(avatar);
        paramCount++;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields to update'
        });
      }

      updates.updated_at = `updated_at = CURRENT_TIMESTAMP`;
      values.push(req.user.id);

      const updateQuery = `
        UPDATE users 
        SET ${Object.values(updates).join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, name, email, phone, avatar_url, is_verified, total_rides, rating, member_since
      `;

      const result = await query(updateQuery, values);
      const user = result.rows[0];

      logger.info(`Profile updated for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Profile updated successfully',
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
      logger.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }
  }
);

// Upload avatar
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    await query(
      'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [avatarUrl, req.user.id]
    );

    logger.info(`Avatar uploaded for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: {
        avatarUrl
      }
    });
  } catch (error) {
    logger.error('Avatar upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar'
    });
  }
});

// Change password
router.put('/password',
  authenticateToken,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      // Get current password hash
      const result = await query(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user.id]
      );

      const user = result.rows[0];

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const saltRounds = 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newPasswordHash, req.user.id]
      );

      // Invalidate all sessions except current one
      await query(
        'DELETE FROM user_sessions WHERE user_id = $1',
        [req.user.id]
      );

      logger.info(`Password changed for user: ${req.user.id}`);

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to change password'
      });
    }
  }
);

// Delete account
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    // Soft delete - mark as inactive
    await query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.user.id]
    );

    // Delete all sessions
    await query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [req.user.id]
    );

    logger.info(`Account deleted for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

// Get user's ride history
router.get('/rides', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT r.id, r.from_location, r.to_location, r.departure_time, r.completion_time,
              rp.amount_paid, rp.pickup_location, rp.dropoff_location, rp.rating, rp.review,
              r.distance_km, r.duration_minutes, r.status
       FROM rides r
       JOIN ride_participants rp ON r.id = rp.ride_id
       WHERE rp.user_id = $1
       ORDER BY r.departure_time DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) FROM ride_participants WHERE user_id = $1',
      [req.user.id]
    );

    const totalRides = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRides / limit);

    res.json({
      success: true,
      data: {
        rides: result.rows,
        pagination: {
          currentPage: page,
          totalPages,
          totalRides,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logger.error('Get rides error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ride history'
    });
  }
});

module.exports = router;