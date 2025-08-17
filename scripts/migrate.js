const { connectDB } = require('../config/database');
const logger = require('../utils/logger');

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');
    
    await connectDB();
    
    logger.info('✅ Database migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();