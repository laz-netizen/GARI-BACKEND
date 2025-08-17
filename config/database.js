const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'gari_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    logger.info('✅ PostgreSQL connected successfully');
    
    // Test the connection
    const result = await client.query('SELECT NOW()');
    logger.info(`📅 Database time: ${result.rows[0].now}`);
    
    client.release();
    
    // Create tables if they don't exist
    await createTables();
    
    return pool;
  } catch (error) {
    logger.error('❌ PostgreSQL connection failed:', error.message);
    throw error;
  }
};

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        is_verified BOOLEAN DEFAULT false,
        total_rides INTEGER DEFAULT 0,
        rating DECIMAL(3,2) DEFAULT 5.00,
        member_since TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Lobbies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lobbies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id UUID REFERENCES users(id) ON DELETE CASCADE,
        from_location VARCHAR(255) NOT NULL,
        to_location VARCHAR(255) NOT NULL,
        from_coordinates POINT,
        to_coordinates POINT,
        departure_time TIMESTAMP NOT NULL,
        vehicle_type VARCHAR(50) NOT NULL,
        available_seats INTEGER NOT NULL,
        price_per_seat DECIMAL(10,2) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Lobby members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lobby_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        pickup_location VARCHAR(255),
        pickup_coordinates POINT,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active',
        UNIQUE(lobby_id, user_id)
      )
    `);
    
    // Chat messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        message_type VARCHAR(20) DEFAULT 'text',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Rides table (completed rides)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lobby_id UUID REFERENCES lobbies(id),
        driver_id UUID REFERENCES users(id),
        from_location VARCHAR(255) NOT NULL,
        to_location VARCHAR(255) NOT NULL,
        departure_time TIMESTAMP NOT NULL,
        completion_time TIMESTAMP,
        total_amount DECIMAL(10,2) NOT NULL,
        distance_km DECIMAL(8,2),
        duration_minutes INTEGER,
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Ride participants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ride_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ride_id UUID REFERENCES rides(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount_paid DECIMAL(10,2) NOT NULL,
        pickup_location VARCHAR(255),
        dropoff_location VARCHAR(255),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        review TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // User sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        device_info JSONB,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status);
      CREATE INDEX IF NOT EXISTS idx_lobbies_departure ON lobbies(departure_time);
      CREATE INDEX IF NOT EXISTS idx_lobbies_location ON lobbies(from_location, to_location);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_lobby ON chat_messages(lobby_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_rides_user ON ride_participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
    
    await client.query('COMMIT');
    logger.info('✅ Database tables created/verified successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Error creating tables:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  connectDB,
  query: (text, params) => pool.query(text, params)
};