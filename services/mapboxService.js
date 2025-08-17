const mbxClient = require('@mapbox/mapbox-sdk');
const mbxGeocoding = require('@mapbox/mapbox-sdk/services/geocoding');
const mbxDirections = require('@mapbox/mapbox-sdk/services/directions');
const mbxMatrix = require('@mapbox/mapbox-sdk/services/matrix');
const logger = require('../utils/logger');

const mapboxClient = mbxClient({ accessToken: process.env.MAPBOX_SECRET_TOKEN });
const geocodingService = mbxGeocoding(mapboxClient);
const directionsService = mbxDirections(mapboxClient);
const matrixService = mbxMatrix(mapboxClient);

class MapboxService {
  // Geocode address to coordinates
  async geocodeAddress(address) {
    try {
      const response = await geocodingService.forwardGeocode({
        query: address,
        countries: ['ET'], // Ethiopia
        limit: 5,
        types: ['place', 'locality', 'neighborhood', 'address']
      }).send();

      if (response.body.features.length === 0) {
        return null;
      }

      return response.body.features.map(feature => ({
        name: feature.place_name,
        coordinates: feature.center, // [longitude, latitude]
        relevance: feature.relevance,
        context: feature.context
      }));
    } catch (error) {
      logger.error('Geocoding error:', error);
      throw new Error('Failed to geocode address');
    }
  }

  // Reverse geocode coordinates to address
  async reverseGeocode(longitude, latitude) {
    try {
      const response = await geocodingService.reverseGeocode({
        query: [longitude, latitude],
        countries: ['ET'],
        limit: 1
      }).send();

      if (response.body.features.length === 0) {
        return null;
      }

      const feature = response.body.features[0];
      return {
        name: feature.place_name,
        coordinates: feature.center,
        context: feature.context
      };
    } catch (error) {
      logger.error('Reverse geocoding error:', error);
      throw new Error('Failed to reverse geocode coordinates');
    }
  }

  // Get directions between two points
  async getDirections(startCoords, endCoords, profile = 'driving') {
    try {
      const response = await directionsService.getDirections({
        profile: profile, // driving, walking, cycling
        waypoints: [
          { coordinates: startCoords },
          { coordinates: endCoords }
        ],
        geometries: 'geojson',
        overview: 'full',
        steps: true,
        annotations: ['duration', 'distance']
      }).send();

      if (response.body.routes.length === 0) {
        return null;
      }

      const route = response.body.routes[0];
      return {
        distance: route.distance, // meters
        duration: route.duration, // seconds
        geometry: route.geometry,
        steps: route.legs[0].steps
      };
    } catch (error) {
      logger.error('Directions error:', error);
      throw new Error('Failed to get directions');
    }
  }

  // Get optimal route for multiple waypoints
  async getOptimalRoute(waypoints, profile = 'driving') {
    try {
      const response = await directionsService.getDirections({
        profile: profile,
        waypoints: waypoints.map(wp => ({ coordinates: wp })),
        geometries: 'geojson',
        overview: 'full',
        steps: true,
        annotations: ['duration', 'distance'],
        roundtrip: false
      }).send();

      if (response.body.routes.length === 0) {
        return null;
      }

      const route = response.body.routes[0];
      return {
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
        waypoint_order: response.body.waypoints.map((wp, index) => ({
          index,
          name: wp.name,
          coordinates: wp.location
        }))
      };
    } catch (error) {
      logger.error('Optimal route error:', error);
      throw new Error('Failed to get optimal route');
    }
  }

  // Get travel time matrix between multiple points
  async getTravelMatrix(coordinates, profile = 'driving') {
    try {
      const response = await matrixService.getMatrix({
        points: coordinates.map(coord => ({ coordinates: coord })),
        profile: profile,
        annotations: ['duration', 'distance']
      }).send();

      return {
        durations: response.body.durations, // 2D array of durations in seconds
        distances: response.body.distances, // 2D array of distances in meters
        sources: response.body.sources,
        destinations: response.body.destinations
      };
    } catch (error) {
      logger.error('Travel matrix error:', error);
      throw new Error('Failed to get travel matrix');
    }
  }

  // Find nearby places
  async findNearbyPlaces(longitude, latitude, category = 'poi', radius = 5000) {
    try {
      const response = await geocodingService.forwardGeocode({
        query: category,
        proximity: [longitude, latitude],
        countries: ['ET'],
        limit: 10,
        types: ['poi']
      }).send();

      return response.body.features.map(feature => ({
        name: feature.place_name,
        coordinates: feature.center,
        category: feature.properties.category,
        distance: this.calculateDistance(
          latitude, longitude,
          feature.center[1], feature.center[0]
        )
      })).filter(place => place.distance <= radius);
    } catch (error) {
      logger.error('Nearby places error:', error);
      throw new Error('Failed to find nearby places');
    }
  }

  // Calculate distance between two coordinates (Haversine formula)
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  // Validate Ethiopian coordinates
  isValidEthiopianCoordinates(longitude, latitude) {
    // Ethiopia bounding box (approximate)
    const minLon = 32.997;
    const maxLon = 47.975;
    const minLat = 3.397;
    const maxLat = 14.959;

    return longitude >= minLon && longitude <= maxLon &&
           latitude >= minLat && latitude <= maxLat;
  }
}

module.exports = new MapboxService();