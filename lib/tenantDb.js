/**
 * Multi-Tenant Database Connection Manager
 * 
 * This file handles dynamic database connections for multi-tenant architecture.
 * Each company (tenant) has its own isolated database within the same MongoDB cluster.
 */

import mongoose from 'mongoose';
import dns from 'dns';
import { getDatabaseUri } from './superadminDb.js';
import { getMongoPoolConfig } from './platform/databaseConfig.js';

// Callback to clear model cache when a connection is recycled
// Set by tenantModels.js to avoid circular imports
function notifyModelCacheClear(databaseName) {
  if (typeof globalThis.__clearTenantModelCache === 'function') {
    globalThis.__clearTenantModelCache(databaseName);
  }
}

// Configure DNS to use Google's DNS servers for reliable SRV resolution
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Tenant database handles share one physical MongoDB pool. Creating a pool per
// tenant multiplies sockets by tenant count inside every server/Vercel process.
// `useDb()` keeps database isolation while reusing the root driver's pool.
const tenantConnections = globalThis.__tenantConnections || new Map();
globalThis.__tenantConnections = tenantConnections;

const sharedTenantRootState = globalThis.__sharedTenantRootState || {
  connection: null,
  promise: null,
  listenersAttached: false,
};
globalThis.__sharedTenantRootState = sharedTenantRootState;

// Pending connection promises to prevent race conditions (persist across reloads)
// Key: database name, Value: Promise<connection>
const pendingConnections = globalThis.__tenantPendingConnections || new Map();
globalThis.__tenantPendingConnections = pendingConnections;

const isProduction = process.env.NODE_ENV === 'production';
const poolConfig = getMongoPoolConfig('tenant');

const CONNECTION_OPTIONS = {
  // Fail explicitly instead of buffering queries against a disconnected pool.
  bufferCommands: false,
  ...poolConfig,
  socketTimeoutMS: 0, // Don't close idle sockets — avoids per-minute reconnect churn
  connectTimeoutMS: isProduction ? 10000 : 5000,
  serverSelectionTimeoutMS: isProduction ? 10000 : 5000,
  wtimeoutMS: 10000,
  family: 4,                    // Force IPv4 to avoid DNS issues
  retryWrites: true,
  retryReads: true,
  heartbeatFrequencyMS: isProduction ? 20000 : 30000, // More frequent heartbeats in production
  // DNS cache to reduce querySrv calls
  directConnection: false,
  // Compression - use only zlib which is always available in Node.js
  compressors: ['zlib'],
  // Auto-reconnect settings
  autoIndex: !isProduction, // Disable auto-indexing in production
};

function clearSharedTenantState() {
  sharedTenantRootState.connection = null;
  sharedTenantRootState.promise = null;
  tenantConnections.clear();
  pendingConnections.clear();
  notifyModelCacheClear();
}

async function getSharedTenantRootConnection(seedDatabaseName) {
  if (sharedTenantRootState.connection?.readyState === 1) {
    return sharedTenantRootState.connection;
  }

  if (sharedTenantRootState.promise) {
    return sharedTenantRootState.promise;
  }

  const rootPromise = (async () => {
    // Seed the shared MongoClient from the first real tenant database. This
    // avoids requiring explicit access to the administrative database while
    // still allowing useDb() to reuse the same underlying socket pool.
    const uri = getDatabaseUri(seedDatabaseName);
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Creating shared tenant database pool (attempt ${attempt}/${maxRetries})`);
        const connection = await mongoose.createConnection(uri, CONNECTION_OPTIONS).asPromise();
        sharedTenantRootState.connection = connection;

        if (!sharedTenantRootState.listenersAttached) {
          sharedTenantRootState.listenersAttached = true;
          connection.on('error', (error) => {
            console.error('❌ Shared tenant database pool error:', error.message);
          });
          connection.on('disconnected', () => {
            console.warn('⚠️ Shared tenant database pool disconnected');
            clearSharedTenantState();
            sharedTenantRootState.listenersAttached = false;
          });
        }

        console.log('✅ Shared tenant database pool connected');
        return connection;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }
    }

    throw lastError || new Error('Failed to connect shared tenant database pool');
  })();

  sharedTenantRootState.promise = rootPromise;
  try {
    return await rootPromise;
  } finally {
    if (sharedTenantRootState.promise === rootPromise) {
      sharedTenantRootState.promise = null;
    }
  }
}

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
  const rootConnection = await getSharedTenantRootConnection(databaseName);
  const connection = rootConnection.useDb(databaseName, {
    useCache: true,
    noListener: true,
  });
  tenantConnections.set(databaseName, connection);
  return connection;
}

/**
 * Close a specific tenant connection
 * @param {string} databaseName - The name of the tenant's database
 */
export async function closeTenantConnection(databaseName) {
  const connection = tenantConnections.get(databaseName);
  if (connection) {
    try {
      if (sharedTenantRootState.connection?.readyState === 1) {
        await sharedTenantRootState.connection.removeDb(databaseName);
      }
      tenantConnections.delete(databaseName);
      notifyModelCacheClear(databaseName);
      console.log(`✅ Closed tenant database handle: ${databaseName}`);
    } catch (error) {
      console.error(`❌ Error closing tenant connection ${databaseName}:`, error.message);
    }
  }
}

/**
 * Close all tenant connections (for graceful shutdown)
 */
export async function closeAllTenantConnections() {
  const rootConnection = sharedTenantRootState.connection;
  clearSharedTenantState();
  sharedTenantRootState.listenersAttached = false;

  if (rootConnection && rootConnection.readyState !== 0) {
    await rootConnection.close();
  }
  console.log('✅ Shared tenant database pool closed');
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
