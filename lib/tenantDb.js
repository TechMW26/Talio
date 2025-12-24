/**
 * Multi-Tenant Database Connection Manager
 * 
 * This file handles dynamic database connections for multi-tenant architecture.
 * Each company (tenant) has its own isolated database within the same MongoDB cluster.
 */

import mongoose from 'mongoose';
import { getDatabaseUri } from './superadminDb';

// Cache for tenant database connections
// Key: database name, Value: mongoose connection
const tenantConnections = new Map();

// Connection pool configuration
const CONNECTION_OPTIONS = {
  bufferCommands: true,
  maxPoolSize: 10,
  minPoolSize: 2,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
  family: 4,
  retryWrites: true,
  retryReads: true,
  maxIdleTimeMS: 60000,
};

/**
 * Get or create a connection to a tenant's database
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

  // Close stale connection if exists
  if (existingConnection && existingConnection.readyState !== 1) {
    try {
      await existingConnection.close();
    } catch (error) {
      console.warn(`Warning: Could not close stale connection for ${databaseName}:`, error.message);
    }
    tenantConnections.delete(databaseName);
  }

  // Create new connection
  const uri = getDatabaseUri(databaseName);
  
  try {
    console.log(`🔄 Creating connection to tenant database: ${databaseName}`);
    
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
    console.error(`❌ Failed to connect to tenant database ${databaseName}:`, error.message);
    throw error;
  }
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

export default getTenantConnection;
