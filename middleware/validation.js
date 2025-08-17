const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Auth validation rules
const registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
];

const loginValidation = [
  body('phone')
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// Lobby validation rules
const createLobbyValidation = [
  body('fromLocation')
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('From location is required'),
  body('toLocation')
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('To location is required'),
  body('departureTime')
    .isISO8601()
    .withMessage('Please provide a valid departure time'),
  body('vehicleType')
    .isIn(['small', 'medium', 'large'])
    .withMessage('Invalid vehicle type'),
  body('availableSeats')
    .isInt({ min: 1, max: 15 })
    .withMessage('Available seats must be between 1 and 15'),
  body('pricePerSeat')
    .isFloat({ min: 0 })
    .withMessage('Price per seat must be a positive number'),
  handleValidationErrors
];

// Chat validation rules
const sendMessageValidation = [
  body('message')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be between 1 and 1000 characters'),
  body('messageType')
    .optional()
    .isIn(['text', 'image', 'location'])
    .withMessage('Invalid message type'),
  handleValidationErrors
];

// UUID validation
const uuidValidation = [
  param('id')
    .isUUID()
    .withMessage('Invalid ID format'),
  handleValidationErrors
];

module.exports = {
  registerValidation,
  loginValidation,
  createLobbyValidation,
  sendMessageValidation,
  uuidValidation,
  handleValidationErrors
};