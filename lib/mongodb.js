import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { 
    conn: null, 
    promise: null, 
    lastConnectAttempt: 0,
    connectionAttempts: 0,
    isConnecting: false
  };
}

// Configuration constants
const MIN_RETRY_INTERVAL = 5000; // 5 seconds between retries
const MAX_RETRY_ATTEMPTS = 3; // Maximum retry attempts for authentication failures
const CONNECTION_TIMEOUT = 10000; // 10 seconds connection timeout

/**
 * Validates if the current connection is healthy
 */
function isConnectionHealthy() {
  return cached.conn && 
         mongoose.connection.readyState === 1 && 
         !mongoose.connection._readyState;
}

/**
 * Clears stale connection state
 */
function clearConnectionState() {
  cached.conn = null;
  cached.promise = null;
  cached.isConnecting = false;
  // Don't reset connectionAttempts here - we need it for retry logic
}

/**
 * Attempts to close existing mongoose connections
 */
async function closeStaleConnections() {
  try {
    if (mongoose.connection.readyState !== 0 && mongoose.connection.readyState !== 1) {
      console.log('🔄 Closing stale MongoDB connection...');
      await mongoose.connection.close();
    }
  } catch (error) {
    console.warn('Warning: Could not close stale connection:', error.message);
  }
}

/**
 * Connect to MongoDB with robust error handling and retry logic
 */
async function connectDB() {
  // Only check for MONGODB_URI when actually connecting (not during build)
  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
  }

  // Return existing healthy connection
  if (isConnectionHealthy()) {
    return cached.conn;
  }

  // Prevent concurrent connection attempts
  if (cached.isConnecting) {
    console.log('⏳ Connection attempt already in progress, waiting...');
    const maxWait = 15000; // 15 seconds max wait
    const startTime = Date.now();
    
    while (cached.isConnecting && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (isConnectionHealthy()) {
        return cached.conn;
      }
    }
    
    // If still connecting after max wait, clear and retry
    if (cached.isConnecting) {
      console.warn('⚠️ Connection timeout, forcing new attempt');
      clearConnectionState();
    }
  }

  // Rate limit connection attempts
  const now = Date.now();
  const timeSinceLastAttempt = now - cached.lastConnectAttempt;
  
  if (timeSinceLastAttempt < MIN_RETRY_INTERVAL && cached.connectionAttempts > 0) {
    const waitTime = MIN_RETRY_INTERVAL - timeSinceLastAttempt;
    console.log(`⏱️ Rate limiting: waiting ${waitTime}ms before retry`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  // Close stale connections before attempting new connection
  if (mongoose.connection.readyState !== 0 && mongoose.connection.readyState !== 1) {
    await closeStaleConnections();
  }

  cached.isConnecting = true;
  cached.lastConnectAttempt = now;
  cached.connectionAttempts++;

  try {
    const opts = {
      bufferCommands: true, // Enable buffering for faster perceived response
      maxPoolSize: 20, // Increased pool size for better concurrency
      minPoolSize: 5, // Keep more connections warm
      socketTimeoutMS: 30000, // Reduced from 45s
      connectTimeoutMS: 5000, // Reduced from 10s for faster failure detection
      serverSelectionTimeoutMS: 5000, // Reduced for faster fallback
      heartbeatFrequencyMS: 10000,
      family: 4, // Force IPv4 to avoid querySrv ETIMEOUT errors
      retryWrites: true,
      retryReads: true,
      maxIdleTimeMS: 30000, // Reduced from 60s - close idle connections faster
      // Authentication retry configuration
      authSource: 'admin',
    };

    console.log(`🔄 Attempting MongoDB connection (attempt ${cached.connectionAttempts})...`);
    
    cached.promise = mongoose.connect(MONGODB_URI, opts);
    
    // Add connection event listeners for better debugging (only once)
    if (cached.connectionAttempts === 1) {
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err.message);
        if (err.name === 'MongoServerError' && err.code === 18) {
          console.error('🔐 Authentication failed - check MONGODB_URI credentials');
        }
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB disconnected');
        clearConnectionState();
      });

      mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB reconnected');
        cached.connectionAttempts = 0; // Reset on successful reconnection
      });
    }

    cached.conn = await cached.promise;
    
    console.log('✅ MongoDB Connected successfully');
    
    // Reset connection attempts on success
    cached.connectionAttempts = 0;
    cached.isConnecting = false;
    
    return cached.conn;
    
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    
    // Handle authentication failures specifically
    if (error.name === 'MongoServerError' && error.code === 18) {
      console.error('🔐 Authentication Error Details:');
      console.error('  - Error Code:', error.code);
      console.error('  - Error Name:', error.codeName);
      console.error('  - Check your MONGODB_URI credentials in .env');
      
      // Retry authentication failures
      if (cached.connectionAttempts < MAX_RETRY_ATTEMPTS) {
        console.log(`🔄 Retrying authentication (${cached.connectionAttempts}/${MAX_RETRY_ATTEMPTS})...`);
        cached.isConnecting = false;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        return connectDB(); // Recursive retry
      } else {
        console.error('❌ Max authentication retry attempts reached');
        cached.connectionAttempts = 0; // Reset for next call
      }
    }
    
    // Clear state on failure
    clearConnectionState();
    cached.connectionAttempts = 0; // Reset attempts after final failure
    
    throw error;
  }
}

export default connectDB;

