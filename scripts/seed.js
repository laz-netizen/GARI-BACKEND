const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const logger = require('../utils/logger');

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    // Create sample users
    const users = [
      {
        name: 'Abebe Kebede',
        email: 'abebe.kebede@example.com',
        phone: '+251911123456',
        password: 'password123'
      },
      {
        name: 'Almaz Bekele',
        email: 'almaz.bekele@example.com',
        phone: '+251911234567',
        password: 'password123'
      },
      {
        name: 'Dawit Haile',
        email: 'dawit.haile@example.com',
        phone: '+251911345678',
        password: 'password123'
      },
      {
        name: 'Tigist Worku',
        email: 'tigist.worku@example.com',
        phone: '+251911456789',
        password: 'password123'
      }
    ];

    const createdUsers = [];

    for (const user of users) {
      // Check if user already exists
      const existingUser = await query(
        'SELECT id FROM users WHERE email = $1 OR phone = $2',
        [user.email, user.phone]
      );

      if (existingUser.rows.length === 0) {
        const passwordHash = await bcrypt.hash(user.password, 12);
        
        const result = await query(
          `INSERT INTO users (name, email, phone, password_hash, is_verified, total_rides, rating)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, email`,
          [user.name, user.email, user.phone, passwordHash, true, Math.floor(Math.random() * 50), 4.0 + Math.random()]
        );

        createdUsers.push(result.rows[0]);
        logger.info(`Created user: ${user.name}`);
      } else {
        createdUsers.push(existingUser.rows[0]);
        logger.info(`User already exists: ${user.name}`);
      }
    }

    // Create sample lobbies
    if (createdUsers.length >= 2) {
      const sampleLobbies = [
        {
          creator_id: createdUsers[0].id,
          from_location: 'Bole',
          to_location: 'Piassa',
          from_coordinates: [38.7578, 8.9806],
          to_coordinates: [38.7469, 9.0320],
          departure_time: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
          vehicle_type: 'medium',
          available_seats: 6,
          price_per_seat: 45.00,
          description: 'Comfortable ride from Bole to Piassa'
        },
        {
          creator_id: createdUsers[1].id,
          from_location: 'Kazanchis',
          to_location: 'Merkato',
          from_coordinates: [38.7614, 9.0157],
          to_coordinates: [38.7034, 9.0084],
          departure_time: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours from now
          vehicle_type: 'small',
          available_seats: 4,
          price_per_seat: 35.00,
          description: 'Quick trip to Merkato for shopping'
        }
      ];

      for (const lobby of sampleLobbies) {
        const result = await query(
          `INSERT INTO lobbies (creator_id, from_location, to_location, from_coordinates, 
                               to_coordinates, departure_time, vehicle_type, available_seats, 
                               price_per_seat, description)
           VALUES ($1, $2, $3, POINT($4, $5), POINT($6, $7), $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            lobby.creator_id,
            lobby.from_location,
            lobby.to_location,
            lobby.from_coordinates[0],
            lobby.from_coordinates[1],
            lobby.to_coordinates[0],
            lobby.to_coordinates[1],
            lobby.departure_time,
            lobby.vehicle_type,
            lobby.available_seats,
            lobby.price_per_seat,
            lobby.description
          ]
        );

        const lobbyId = result.rows[0].id;

        // Add creator as first member
        await query(
          'INSERT INTO lobby_members (lobby_id, user_id, pickup_location) VALUES ($1, $2, $3)',
          [lobbyId, lobby.creator_id, lobby.from_location]
        );

        logger.info(`Created lobby: ${lobby.from_location} to ${lobby.to_location}`);
      }
    }

    logger.info('✅ Database seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();