/**
 * SuperAdmin Database Connection
 * 
 * This file handles connections to the superadmin database which is separate
 * from company-specific databases. The superadmin database stores:
 * - SuperAdmin users (platform administrators)
 * - TenantCompany records (companies using Talio)
 * - Setup codes for new company onboarding
 */

import mongoose from 'mongoose';
import dns from 'dns';
import { getMongoPoolConfig } from './platform/databaseConfig.js';
import { assertDatabaseName } from './platform/databaseName.js';

// Configure DNS to use Google's DNS servers for reliable SRV resolution
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Get the cluster URI without a specific database
const MONGODB_URI = process.env.MONGODB_URI;

// Extract cluster base URI (without database name)
function getClusterBaseUri() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }
  
  // Parse the URI to extract base cluster URL
  // mongodb+srv://user:pass@cluster.mongodb.net/database?options
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  
  if (!match) {
    throw new Error('Invalid MONGODB_URI format');
  }
  
  return {
    baseUri: match[1],
    options: match[3] || ''
  };
}

/**
 * Get connection URI for a specific database
 */
export function getDatabaseUri(databaseName) {
  assertDatabaseName(databaseName);
  const { baseUri, options } = getClusterBaseUri();
  return `${baseUri}/${databaseName}${options}`;
}

// Cached superadmin connection
const connectionState = globalThis.__talioSuperadminConnectionState || { connection: null, promise: null };
globalThis.__talioSuperadminConnectionState = connectionState;
const MAX_CONNECTION_ATTEMPTS = 3;

// Production-aware connection options
const isProduction = process.env.NODE_ENV === 'production';
const poolConfig = getMongoPoolConfig('superadmin');

const SUPERADMIN_CONNECTION_OPTIONS = {
  bufferCommands: false,
  ...poolConfig,
  socketTimeoutMS: 0, // Don't close idle sockets — avoids per-minute reconnect churn
  connectTimeoutMS: isProduction ? 20000 : 10000,
  serverSelectionTimeoutMS: isProduction ? 20000 : 10000,
  waitQueueTimeoutMS: 5000,
  family: 4, // Force IPv4 to avoid querySrv ETIMEOUT errors
  retryWrites: true,
  retryReads: true,
  compressors: ['zlib'],
  autoIndex: !isProduction,
};

/**
 * Connect to the superadmin database
 * This is a separate connection from the main app database
 */
export async function connectSuperadminDB() {
  if (connectionState.connection) return connectionState.connection;
  if (connectionState.promise) return connectionState.promise;

  const promise = openSuperadminConnection();
  connectionState.promise = promise;
  try {
    return await promise;
  } finally {
    if (connectionState.promise === promise) connectionState.promise = null;
  }
}

async function openSuperadminConnection() {
  const uri = getDatabaseUri('talio_superadmin');
  
  // Retry loop for transient connection errors
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt++) {
    let openingConnection;
    try {
      openingConnection = mongoose.createConnection(uri, SUPERADMIN_CONNECTION_OPTIONS);
      const connection = await openingConnection.asPromise();
      connectionState.connection = connection;

      console.log('✅ SuperAdmin DB connected successfully');
      
      // Handle connection events
      connection.on('error', (err) => {
        console.error('❌ SuperAdmin DB connection error:', err.message);
      });

      connection.on('disconnected', () => {
        console.warn('⚠️ SuperAdmin DB disconnected');
      });
      connection.on('close', () => {
        if (connectionState.connection === connection) connectionState.connection = null;
      });

      return connection;
    } catch (error) {
      lastError = error;
      console.error(`❌ SuperAdmin DB Connection Error (attempt ${attempt}/${MAX_CONNECTION_ATTEMPTS}):`, error.message);
      await openingConnection?.close?.().catch(() => {});
      
      // Check if it's a transient error worth retrying
      const isTransient = error.message.includes('ETIMEOUT') || 
                         error.message.includes('ECONNREFUSED') ||
                         error.message.includes('querySrv') ||
                         error.message.includes('getaddrinfo');
      
      if (isTransient && attempt < MAX_CONNECTION_ATTEMPTS) {
        // Wait before retry (exponential backoff)
        const waitTime = 1000 * attempt;
        console.log(`🔄 Retrying SuperAdmin DB connection in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Non-transient error or max retries reached
      throw error;
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('Failed to connect to SuperAdmin DB after retries');
}

/**
 * Get the superadmin database connection
 */
export function getSuperadminConnection() {
  return connectionState.connection;
}

export default connectSuperadminDB;
