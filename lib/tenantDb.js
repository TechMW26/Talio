/**
 * Multi-Tenant Database Connection Manager
 * 
 * This file handles dynamic database connections for multi-tenant architecture.
 * Each company (tenant) has its own isolated database within the same MongoDB cluster.
 */

import mongoose from 'mongoose';
import dns from 'dns';
import { getDatabaseUri } from './superadminDb';

// Configure DNS to use Google's DNS servers for reliable SRV resolution
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Cache for tenant database connections (persist across dev hot reloads)
// Key: database name, Value: mongoose connection
const tenantConnections = globalThis.__tenantConnections || new Map();
globalThis.__tenantConnections = tenantConnections;

// Pending connection promises to prevent race conditions (persist across reloads)
// Key: database name, Value: Promise<connection>
const pendingConnections = globalThis.__tenantPendingConnections || new Map();
globalThis.__tenantPendingConnections = pendingConnections;

// Connection pool configuration - optimized for dev speed and large document writes
const CONNECTION_OPTIONS = {
  bufferCommands: true,
  maxPoolSize: 10,              // Reduced for dev, increase in production
  minPoolSize: 2,               // Fewer warm connections for dev
  socketTimeoutMS: 45000,       // 45 seconds socket timeout
  connectTimeoutMS: 10000,      // 10 seconds connect timeout (faster fail)
  serverSelectionTimeoutMS: 10000, // 10 seconds server selection (faster fail)
  wtimeoutMS: 30000,            // 30 seconds write timeout
  family: 4,                    // Force IPv4 to avoid DNS issues
  retryWrites: true,
  retryReads: true,
  maxIdleTimeMS: 60000,         // 1 minute idle
  heartbeatFrequencyMS: 30000,  // Less frequent heartbeats for dev
  // DNS cache to reduce querySrv calls
  directConnection: false,
  // TLS settings for better stability
  tls: true,
  tlsAllowInvalidCertificates: false,
  // Compression for large payloads
  compressors: ['zlib'],
};

/**
 * Get or create a connection to a tenant's database
 * Uses a promise-based lock to prevent race conditions when multiple
 * requests try to connect to the same database simultaneously.
 * @param {string} databaseName - The name of the tenant's database
 * @returns {Promise<mongoose.Connection>} - The mongoose connection
 */
export async function getTenantConnection(databaseName) {
  if (!databaseName) {
    throw new Error('Database name is required for tenant connection');
  }

  // Check if we have an existing healthy connection
  const existingConnection = tenantConnections.get(databaseName);
  if (existingConnection && existingConnection.readyState === 1) {
    return existingConnection;
  }

  // Check if there's already a pending connection attempt
  // This prevents race conditions where multiple requests try to connect simultaneously
  if (pendingConnections.has(databaseName)) {
    return pendingConnections.get(databaseName);
  }

  // Create a connection promise and store it immediately
  const connectionPromise = createConnection(databaseName);
  pendingConnections.set(databaseName, connectionPromise);

  try {
    const connection = await connectionPromise;
    return connection;
  } finally {
    // Clean up pending promise after resolution (success or failure)
    pendingConnections.delete(databaseName);
  }
}

/**
 * Internal function to create a new database connection with retry logic
 * @param {string} databaseName - The name of the tenant's database
 * @returns {Promise<mongoose.Connection>} - The mongoose connection
 */
async function createConnection(databaseName) {
  // Close stale connection if exists
  const existingConnection = tenantConnections.get(databaseName);
  if (existingConnection && existingConnection.readyState !== 1) {
    try {
      await existingConnection.close();
    } catch (error) {
      console.warn(`Warning: Could not close stale connection for ${databaseName}:`, error.message);
    }
    tenantConnections.delete(databaseName);
  }

  // Create new connection with retry logic
  const uri = getDatabaseUri(databaseName);
  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🔄 Creating connection to tenant database: ${databaseName} (attempt ${attempt}/${MAX_RETRIES})`);

      const connection = await mongoose.createConnection(uri, CONNECTION_OPTIONS).asPromise();

      // Set up event handlers
      connection.on('error', (err) => {
        console.error(`❌ Tenant DB (${databaseName}) error:`, err.message);
      });

      connection.on('disconnected', () => {
        console.warn(`⚠️ Tenant DB (${databaseName}) disconnected`);
        tenantConnections.delete(databaseName);
      });

      connection.on('reconnected', () => {
        console.log(`✅ Tenant DB (${databaseName}) reconnected`);
      });

      // Cache the connection
      tenantConnections.set(databaseName, connection);

      console.log(`✅ Connected to tenant database: ${databaseName}`);

      return connection;
    } catch (error) {
      lastError = error;
      console.error(`❌ Failed to connect to tenant database ${databaseName} (attempt ${attempt}/${MAX_RETRIES}):`, error.message);

      // Check if it's a transient error worth retrying
      const isTransient = error.message.includes('ETIMEOUT') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('socket disconnected') ||
        error.message.includes('TLS connection') ||
        error.message.includes('querySrv') ||
        error.message.includes('getaddrinfo') ||
        error.message.includes('pool was cleared') ||
        error.message.includes('MongoNetworkError') ||
        error.name === 'MongoNetworkError' ||
        error.name === 'MongoPoolClearedError';

      if (isTransient && attempt < MAX_RETRIES) {
        // Wait before retry (exponential backoff)
        const waitTime = 1500 * attempt; // Increased wait time
        console.log(`🔄 Retrying tenant DB connection in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // Non-transient error or max retries reached
      throw error;
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error(`Failed to connect to tenant database ${databaseName} after retries`);
}

/**
 * Close a specific tenant connection
 * @param {string} databaseName - The name of the tenant's database
 */
export async function closeTenantConnection(databaseName) {
  const connection = tenantConnections.get(databaseName);
  if (connection) {
    try {
      await connection.close();
      tenantConnections.delete(databaseName);
      console.log(`✅ Closed connection to tenant database: ${databaseName}`);
    } catch (error) {
      console.error(`❌ Error closing tenant connection ${databaseName}:`, error.message);
    }
  }
}

/**
 * Close all tenant connections (for graceful shutdown)
 */
export async function closeAllTenantConnections() {
  const closePromises = [];

  for (const [databaseName, connection] of tenantConnections) {
    closePromises.push(
      connection.close()
        .then(() => console.log(`✅ Closed connection: ${databaseName}`))
        .catch(err => console.error(`❌ Error closing ${databaseName}:`, err.message))
    );
  }

  await Promise.all(closePromises);
  tenantConnections.clear();
  console.log('✅ All tenant connections closed');
}

/**
 * Get all active tenant connections (for monitoring)
 */
export function getActiveTenantConnections() {
  const active = [];
  for (const [databaseName, connection] of tenantConnections) {
    active.push({
      databaseName,
      readyState: connection.readyState,
      readyStateString: ['disconnected', 'connected', 'connecting', 'disconnecting'][connection.readyState] || 'unknown'
    });
  }
  return active;
}

/**
 * Check if a tenant database exists (by checking for collections)
 * @param {string} databaseName - The name of the database to check
 * @returns {Promise<boolean>} - Whether the database has collections
 */
export async function tenantDatabaseExists(databaseName) {
  try {
    const connection = await getTenantConnection(databaseName);
    const collections = await connection.db.listCollections().toArray();
    return collections.length > 0;
  } catch (error) {
    console.error(`Error checking if database ${databaseName} exists:`, error.message);
    return false;
  }
}

/**
 * Drop a tenant database completely
 * WARNING: This permanently deletes all data in the tenant's database!
 * @param {string} databaseName - The name of the database to drop
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function dropTenantDatabase(databaseName) {
  if (!databaseName) {
    return { success: false, message: 'Database name is required' };
  }

  // Safety check: prevent dropping system databases
  if (!databaseName.startsWith('talio_company_')) {
    return { success: false, message: 'Can only drop tenant company databases (talio_company_*)' };
  }

  try {
    console.log(`⚠️ Dropping tenant database: ${databaseName}`);

    // Get or create connection to the database
    const connection = await getTenantConnection(databaseName);

    // Drop the database
    await connection.db.dropDatabase();

    // Close and remove the connection from cache
    await closeTenantConnection(databaseName);

    console.log(`✅ Successfully dropped tenant database: ${databaseName}`);
    return { success: true, message: `Database ${databaseName} dropped successfully` };
  } catch (error) {
    console.error(`❌ Error dropping tenant database ${databaseName}:`, error.message);

    // If database doesn't exist, consider it a success
    if (error.message.includes('not found') || error.message.includes('doesn\'t exist')) {
      return { success: true, message: 'Database was already deleted or does not exist' };
    }

    return { success: false, message: `Failed to drop database: ${error.message}` };
  }
}

export default getTenantConnection;
