const express = require('express');
const mapboxService = require('../services/mapboxService');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// Get Mapbox public token
router.get('/token', (req, res) => {
  res.json({
    success: true,
    data: {
      publicToken: process.env.MAPBOX_PUBLIC_TOKEN
    }
  });
});

// Geocode address
router.get('/geocode', optionalAuth, async (req, res) => {
  try {
    const { address } = req.query;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address parameter is required'
      });
    }

    const results = await mapboxService.geocodeAddress(address);

    if (!results) {
      return res.status(404).json({
        success: false,
        message: 'No results found for the given address'
      });
    }

    res.json({
      success: true,
      data: { results }
    });
  } catch (error) {
    logger.error('Geocoding error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to geocode address'
    });
  }
});

// Reverse geocode coordinates
router.get('/reverse-geocode', optionalAuth, async (req, res) => {
  try {
    const { longitude, latitude } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Longitude and latitude parameters are required'
      });
    }

    const lon = parseFloat(longitude);
    const lat = parseFloat(latitude);

    if (isNaN(lon) || isNaN(lat)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Validate Ethiopian coordinates
    if (!mapboxService.isValidEthiopianCoordinates(lon, lat)) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates must be within Ethiopia'
      });
    }

    const result = await mapboxService.reverseGeocode(lon, lat);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No address found for the given coordinates'
      });
    }

    res.json({
      success: true,
      data: { result }
    });
  } catch (error) {
    logger.error('Reverse geocoding error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reverse geocode coordinates'
    });
  }
});

// Get directions between two points
router.get('/directions', optionalAuth, async (req, res) => {
  try {
    const { startLon, startLat, endLon, endLat, profile = 'driving' } = req.query;

    if (!startLon || !startLat || !endLon || !endLat) {
      return res.status(400).json({
        success: false,
        message: 'Start and end coordinates are required'
      });
    }

    const startCoords = [parseFloat(startLon), parseFloat(startLat)];
    const endCoords = [parseFloat(endLon), parseFloat(endLat)];

    // Validate coordinates
    if (startCoords.some(isNaN) || endCoords.some(isNaN)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    if (!mapboxService.isValidEthiopianCoordinates(startCoords[0], startCoords[1]) ||
        !mapboxService.isValidEthiopianCoordinates(endCoords[0], endCoords[1])) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates must be within Ethiopia'
      });
    }

    const directions = await mapboxService.getDirections(startCoords, endCoords, profile);

    if (!directions) {
      return res.status(404).json({
        success: false,
        message: 'No route found between the given points'
      });
    }

    res.json({
      success: true,
      data: { directions }
    });
  } catch (error) {
    logger.error('Directions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get directions'
    });
  }
});

// Get optimal route for multiple waypoints
router.post('/optimal-route', authenticateToken, async (req, res) => {
  try {
    const { waypoints, profile = 'driving' } = req.body;

    if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 waypoints are required'
      });
    }

    if (waypoints.length > 25) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 25 waypoints allowed'
      });
    }

    // Validate all waypoints
    for (const waypoint of waypoints) {
      if (!Array.isArray(waypoint) || waypoint.length !== 2) {
        return res.status(400).json({
          success: false,
          message: 'Each waypoint must be an array of [longitude, latitude]'
        });
      }

      const [lon, lat] = waypoint;
      if (isNaN(lon) || isNaN(lat)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates in waypoints'
        });
      }

      if (!mapboxService.isValidEthiopianCoordinates(lon, lat)) {
        return res.status(400).json({
          success: false,
          message: 'All waypoints must be within Ethiopia'
        });
      }
    }

    const optimalRoute = await mapboxService.getOptimalRoute(waypoints, profile);

    if (!optimalRoute) {
      return res.status(404).json({
        success: false,
        message: 'No optimal route found for the given waypoints'
      });
    }

    res.json({
      success: true,
      data: { optimalRoute }
    });
  } catch (error) {
    logger.error('Optimal route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get optimal route'
    });
  }
});

// Get travel time matrix
router.post('/travel-matrix', authenticateToken, async (req, res) => {
  try {
    const { coordinates, profile = 'driving' } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 coordinate pairs are required'
      });
    }

    if (coordinates.length > 25) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 25 coordinate pairs allowed'
      });
    }

    // Validate all coordinates
    for (const coord of coordinates) {
      if (!Array.isArray(coord) || coord.length !== 2) {
        return res.status(400).json({
          success: false,
          message: 'Each coordinate must be an array of [longitude, latitude]'
        });
      }

      const [lon, lat] = coord;
      if (isNaN(lon) || isNaN(lat)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates'
        });
      }

      if (!mapboxService.isValidEthiopianCoordinates(lon, lat)) {
        return res.status(400).json({
          success: false,
          message: 'All coordinates must be within Ethiopia'
        });
      }
    }

    const matrix = await mapboxService.getTravelMatrix(coordinates, profile);

    res.json({
      success: true,
      data: { matrix }
    });
  } catch (error) {
    logger.error('Travel matrix error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get travel matrix'
    });
  }
});

// Find nearby places
router.get('/nearby', optionalAuth, async (req, res) => {
  try {
    const { longitude, latitude, category = 'poi', radius = 5000 } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Longitude and latitude parameters are required'
      });
    }

    const lon = parseFloat(longitude);
    const lat = parseFloat(latitude);
    const searchRadius = parseInt(radius);

    if (isNaN(lon) || isNaN(lat) || isNaN(searchRadius)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid parameters'
      });
    }

    if (!mapboxService.isValidEthiopianCoordinates(lon, lat)) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates must be within Ethiopia'
      });
    }

    if (searchRadius > 50000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum search radius is 50km'
      });
    }

    const places = await mapboxService.findNearbyPlaces(lon, lat, category, searchRadius);

    res.json({
      success: true,
      data: { places }
    });
  } catch (error) {
    logger.error('Nearby places error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find nearby places'
    });
  }
});

// Get Ethiopian locations (predefined popular locations)
router.get('/ethiopian-locations', (req, res) => {
  try {
    const locations = [
      { name: 'Bole', latitude: 8.9806, longitude: 38.7578, type: 'district' },
      { name: 'Piassa', latitude: 9.0320, longitude: 38.7469, type: 'district' },
      { name: 'Kazanchis', latitude: 9.0157, longitude: 38.7614, type: 'district' },
      { name: 'Merkato', latitude: 9.0084, longitude: 38.7034, type: 'market' },
      { name: 'CMC', latitude: 9.0054, longitude: 38.7636, type: 'district' },
      { name: 'Arat Kilo', latitude: 9.0320, longitude: 38.7469, type: 'district' },
      { name: 'Megenagna', latitude: 8.9806, longitude: 38.7578, type: 'district' },
      { name: 'Legehar', latitude: 9.0320, longitude: 38.7469, type: 'district' },
      { name: 'Bole Airport', latitude: 8.9806, longitude: 38.7578, type: 'airport' },
      { name: 'Mexico', latitude: 9.0157, longitude: 38.7614, type: 'district' },
      { name: 'Gotera', latitude: 9.0084, longitude: 38.7034, type: 'district' },
      { name: 'Addis Ababa University', latitude: 9.0320, longitude: 38.7469, type: 'university' },
      { name: 'Meskel Square', latitude: 9.0120, longitude: 38.7580, type: 'landmark' },
      { name: 'National Theatre', latitude: 9.0320, longitude: 38.7469, type: 'landmark' }
    ];

    const { search } = req.query;
    let filteredLocations = locations;

    if (search) {
      const searchTerm = search.toLowerCase();
      filteredLocations = locations.filter(location =>
        location.name.toLowerCase().includes(searchTerm) ||
        location.type.toLowerCase().includes(searchTerm)
      );
    }

    res.json({
      success: true,
      data: { locations: filteredLocations }
    });
  } catch (error) {
    logger.error('Get Ethiopian locations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Ethiopian locations'
    });
  }
});

module.exports = router;