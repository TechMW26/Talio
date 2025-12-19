/**
 * MongoDB Native Driver Connection
 * Used for vector search operations
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.MONGODB_DB_NAME || 'hrms_db';

// Global cache for MongoDB client
let cachedClient = null;
let cachedDb = null;
let isConnecting = false;
let lastConnectionAttempt = 0;
let connectionAttempts = 0;

const MAX_RETRY_ATTEMPTS = 3;
const MIN_RETRY_INTERVAL = 2000;

/**
 * Validates if the connection is healthy
 */
async function isConnectionHealthy() {
  if (!cachedClient || !cachedDb) return false;
  
  try {
    // Ping the database to check if connection is alive
    await cachedDb.admin().ping();
    return true;
  } catch (error) {
    console.warn('⚠️ MongoDB Native connection unhealthy:', error.message);
    return false;
  }
}

/**
 * Clears cached connection state
 */
function clearConnectionCache() {
  cachedClient = null;
  cachedDb = null;
  isConnecting = false;
}

/**
 * Get MongoDB database connection
 * Uses connection pooling and caching with retry logic
 */
export async function getDatabase() {
  // Validate MongoDB URI
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  // Check if cached connection is still healthy
  if (cachedDb && await isConnectionHealthy()) {
    return cachedDb;
  }

  // Clear unhealthy cache
  if (cachedDb && !await isConnectionHealthy()) {
    console.log('🔄 Clearing unhealthy MongoDB Native connection');
    try {
      await cachedClient?.close();
    } catch (err) {
      // Ignore close errors
    }
    clearConnectionCache();
  }

  // Prevent concurrent connection attempts
  if (isConnecting) {
    console.log('⏳ MongoDB Native connection attempt in progress, waiting...');
    const maxWait = 10000;
    const startTime = Date.now();
    
    while (isConnecting && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (cachedDb && await isConnectionHealthy()) {
        return cachedDb;
      }
    }
    
    if (isConnecting) {
      console.warn('⚠️ Connection timeout, forcing new attempt');
      clearConnectionCache();
    }
  }

  // Rate limit connection attempts
  const now = Date.now();
  if (now - lastConnectionAttempt < MIN_RETRY_INTERVAL && connectionAttempts > 0) {
    const waitTime = MIN_RETRY_INTERVAL - (now - lastConnectionAttempt);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  isConnecting = true;
  lastConnectionAttempt = now;
  connectionAttempts++;

  try {
    console.log(`🔄 Connecting MongoDB Native Driver (attempt ${connectionAttempts})...`);
    
    // Create new client if not cached
    if (!cachedClient) {
      cachedClient = new MongoClient(MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        retryReads: true,
        maxIdleTimeMS: 60000,
      });

      await cachedClient.connect();
      console.log('✅ MongoDB Native Driver connected');
    }

    // Cache the database
    cachedDb = cachedClient.db(DATABASE_NAME);
    
    // Verify connection with ping
    await cachedDb.admin().ping();
    
    isConnecting = false;
    connectionAttempts = 0; // Reset on success
    
    return cachedDb;
    
  } catch (error) {
    console.error('❌ MongoDB Native connection error:', error.message);
    
    // Handle authentication failures
    if (error.code === 18 || error.codeName === 'AuthenticationFailed') {
      console.error('🔐 MongoDB Native Authentication failed');
      
      // Retry authentication failures
      if (connectionAttempts < MAX_RETRY_ATTEMPTS) {
        console.log(`🔄 Retrying MongoDB Native connection (${connectionAttempts}/${MAX_RETRY_ATTEMPTS})...`);
        isConnecting = false;
        await new Promise(resolve => setTimeout(resolve, 2000));
        return getDatabase(); // Recursive retry
      }
    }
    
    // Clear cache on failure
    clearConnectionCache();
    connectionAttempts = 0;
    
    throw error;
  }
}

/**
 * Get a specific collection
 */
export async function getCollection(collectionName) {
  const db = await getDatabase();
  return db.collection(collectionName);
}

/**
 * Close MongoDB connection
 * Only use this when shutting down the application
 */
export async function closeConnection() {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
    console.log('✅ MongoDB connection closed');
  }
}

// Export the client for advanced use cases
export async function getClient() {
  if (!cachedClient) {
    await getDatabase(); // This will create the client
  }
  return cachedClient;
}

export default getDatabase;

