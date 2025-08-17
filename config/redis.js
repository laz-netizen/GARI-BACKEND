const redis = require('redis');
const logger = require('../utils/logger');

let redisClient;

const connectRedis = async () => {
  try {
    redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis server connection refused');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          logger.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          logger.error('Redis max retry attempts reached');
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis connected successfully');
    });

    redisClient.on('ready', () => {
      logger.info('🔴 Redis ready for operations');
    });

    redisClient.on('end', () => {
      logger.info('Redis connection ended');
    });

    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    logger.info('🏓 Redis ping successful');
    
    return redisClient;
  } catch (error) {
    logger.error('❌ Redis connection failed:', error.message);
    // Don't throw error, allow app to continue without Redis
    logger.warn('⚠️  Continuing without Redis cache');
    return null;
  }
};

const getRedisClient = () => {
  return redisClient;
};

// Cache helper functions
const setCache = async (key, value, expireInSeconds = 3600) => {
  if (!redisClient) return false;
  
  try {
    await redisClient.setEx(key, expireInSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.error('Redis set error:', error);
    return false;
  }
};

const getCache = async (key) => {
  if (!redisClient) return null;
  
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error('Redis get error:', error);
    return null;
  }
};

const deleteCache = async (key) => {
  if (!redisClient) return false;
  
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    logger.error('Redis delete error:', error);
    return false;
  }
};

const flushCache = async () => {
  if (!redisClient) return false;
  
  try {
    await redisClient.flushAll();
    return true;
  } catch (error) {
    logger.error('Redis flush error:', error);
    return false;
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  setCache,
  getCache,
  deleteCache,
  flushCache
};