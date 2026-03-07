/**
 * Migration Script: Remove plaintextPassword → encryptedOnboardingPassword
 * 
 * PURPOSE:
 * This script migrates all existing user documents from storing plaintext
 * passwords to AES-256-GCM encrypted onboarding passwords, then removes
 * the plaintextPassword field entirely.
 * 
 * SAFETY FEATURES:
 * - Batched processing (100 docs at a time) to avoid memory pressure
 * - Dry-run mode by default (set DRY_RUN=false to execute)
 * - Full logging of every operation
 * - Rollback-safe: original data is only removed AFTER successful encryption
 * - Idempotent: can be safely re-run
 * 
 * USAGE:
 *   # Dry run (preview changes):
 *   node scripts/migrate-plaintext-passwords.js
 * 
 *   # Execute migration:
 *   DRY_RUN=false node scripts/migrate-plaintext-passwords.js
 * 
 *   # With custom batch size:
 *   DRY_RUN=false BATCH_SIZE=50 node scripts/migrate-plaintext-passwords.js
 * 
 * PREREQUISITES:
 *   - ONBOARDING_PASSWORD_KEY or JWT_SECRET must be set in environment
 *   - MONGODB_URI must point to the correct database
 *   - SUPERADMIN_DB_URI for tenant discovery (multi-tenant setup)
 * 
 * ROLLBACK:
 *   If something goes wrong mid-migration, the script can be re-run safely.
 *   Documents that already have encryptedOnboardingPassword will be skipped.
 *   The plaintextPassword field is only unset AFTER encryption succeeds.
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// ─── Encryption (inline to avoid import issues in standalone script) ─────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const envKey = process.env.ONBOARDING_PASSWORD_KEY;
  if (envKey) {
    if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    }
    return crypto.createHash('sha256').update(envKey).digest();
  }
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret) {
    return crypto.createHash('sha256')
      .update(`onboarding-password-encryption:${jwtSecret}`)
      .digest();
  }
  throw new Error('ONBOARDING_PASSWORD_KEY or JWT_SECRET required');
}

function encryptPassword(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN !== 'false';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;

// ─── Logging ────────────────────────────────────────────────────────────────

const stats = {
  totalDatabases: 0,
  totalUsersScanned: 0,
  totalWithPlaintext: 0,
  totalEncrypted: 0,
  totalAlreadyMigrated: 0,
  totalCleanedUp: 0,
  totalErrors: 0,
  errors: [],
};

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [MIGRATION] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`, Object.keys(data).length ? data : '');
  } else {
    console.log(`${prefix} ${message}`, Object.keys(data).length ? data : '');
  }
}

// ─── Migration Logic ────────────────────────────────────────────────────────

async function migrateTenantDatabase(uri, dbName) {
  log('info', `Processing database: ${dbName}`);
  
  let connection;
  try {
    connection = await mongoose.createConnection(uri, {
      dbName: dbName,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
    }).asPromise();

    const usersCollection = connection.collection('users');
    
    // Count total documents with plaintextPassword
    const totalWithPlaintext = await usersCollection.countDocuments({
      plaintextPassword: { $exists: true, $ne: null },
    });
    
    // Count documents already migrated
    const totalAlreadyMigrated = await usersCollection.countDocuments({
      encryptedOnboardingPassword: { $exists: true, $ne: null },
      plaintextPassword: { $exists: false },
    });
    
    log('info', `  Database ${dbName}: ${totalWithPlaintext} with plaintext, ${totalAlreadyMigrated} already migrated`);
    stats.totalWithPlaintext += totalWithPlaintext;
    stats.totalAlreadyMigrated += totalAlreadyMigrated;
    
    if (totalWithPlaintext === 0) {
      log('info', `  No plaintext passwords to migrate in ${dbName}`);
      return;
    }
    
    // Process in batches
    let processed = 0;
    let cursor = usersCollection.find(
      { plaintextPassword: { $exists: true, $ne: null } },
      { projection: { _id: 1, email: 1, plaintextPassword: 1, forcePasswordChange: 1 } }
    ).batchSize(BATCH_SIZE);
    
    const batch = [];
    
    for await (const doc of cursor) {
      stats.totalUsersScanned++;
      
      try {
        const encrypted = encryptPassword(doc.plaintextPassword);
        
        if (!encrypted) {
          log('warn', `  Skipping user ${doc.email} — encryption returned null`);
          continue;
        }
        
        if (DRY_RUN) {
          log('info', `  [DRY RUN] Would encrypt password for: ${doc.email} (forcePasswordChange: ${doc.forcePasswordChange})`);
          stats.totalEncrypted++;
        } else {
          batch.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: { encryptedOnboardingPassword: encrypted },
                $unset: { plaintextPassword: '' },
              },
            },
          });
          
          if (batch.length >= BATCH_SIZE) {
            const result = await usersCollection.bulkWrite(batch);
            processed += result.modifiedCount;
            stats.totalEncrypted += result.modifiedCount;
            stats.totalCleanedUp += result.modifiedCount;
            log('info', `  Batch processed: ${result.modifiedCount} users encrypted in ${dbName}`);
            batch.length = 0;
          }
        }
      } catch (err) {
        stats.totalErrors++;
        stats.errors.push({ email: doc.email, db: dbName, error: err.message });
        log('error', `  Failed to process user ${doc.email}:`, { error: err.message });
      }
    }
    
    // Process remaining batch
    if (!DRY_RUN && batch.length > 0) {
      const result = await usersCollection.bulkWrite(batch);
      processed += result.modifiedCount;
      stats.totalEncrypted += result.modifiedCount;
      stats.totalCleanedUp += result.modifiedCount;
      log('info', `  Final batch: ${result.modifiedCount} users encrypted in ${dbName}`);
    }
    
    log('info', `  Completed ${dbName}: ${DRY_RUN ? totalWithPlaintext + ' would be' : processed} encrypted`);
    
  } catch (error) {
    stats.totalErrors++;
    stats.errors.push({ db: dbName, error: error.message });
    log('error', `Failed to process database ${dbName}:`, { error: error.message });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

async function discoverTenantDatabases() {
  const superadminUri = process.env.SUPERADMIN_DB_URI || process.env.MONGODB_URI;
  
  if (!superadminUri) {
    throw new Error('SUPERADMIN_DB_URI or MONGODB_URI is required');
  }
  
  log('info', 'Connecting to superadmin database to discover tenants...');
  
  const connection = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  
  try {
    const tenantCompanies = connection.collection('tenantcompanies');
    const tenants = await tenantCompanies.find(
      { isActive: true },
      { projection: { databaseName: 1, name: 1 } }
    ).toArray();
    
    log('info', `Found ${tenants.length} active tenant databases`);
    return tenants;
  } finally {
    await connection.close();
  }
}

async function main() {
  log('info', '══════════════════════════════════════════════════════════════');
  log('info', 'Plaintext Password Migration Script');
  log('info', `Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '🔴 LIVE EXECUTION'}`);
  log('info', `Batch size: ${BATCH_SIZE}`);
  log('info', '══════════════════════════════════════════════════════════════');
  
  // Verify encryption key is available before starting
  try {
    getEncryptionKey();
    log('info', 'Encryption key verified ✓');
  } catch (error) {
    log('error', 'Encryption key not available. Cannot proceed.', { error: error.message });
    process.exit(1);
  }
  
  try {
    // Discover all tenant databases
    const tenants = await discoverTenantDatabases();
    stats.totalDatabases = tenants.length;
    
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is required');
    }
    
    // Extract base URI (without database name)
    const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, '/$1');
    
    // Process each tenant database
    for (const tenant of tenants) {
      await migrateTenantDatabase(baseUri, tenant.databaseName);
    }
    
    // Also process the default database (if any users exist there)
    const defaultDb = mongoUri.match(/\/([^/?]+)(?:\?|$)/)?.[1];
    if (defaultDb && !tenants.some(t => t.databaseName === defaultDb)) {
      await migrateTenantDatabase(mongoUri, defaultDb);
    }
    
  } catch (error) {
    log('error', 'Migration failed:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
  
  // Print summary
  log('info', '');
  log('info', '══════════════════════════════════════════════════════════════');
  log('info', 'MIGRATION SUMMARY');
  log('info', '══════════════════════════════════════════════════════════════');
  log('info', `Databases processed:    ${stats.totalDatabases}`);
  log('info', `Users scanned:          ${stats.totalUsersScanned}`);
  log('info', `With plaintext found:   ${stats.totalWithPlaintext}`);
  log('info', `Encrypted:              ${stats.totalEncrypted}${DRY_RUN ? ' (dry run)' : ''}`);
  log('info', `Already migrated:       ${stats.totalAlreadyMigrated}`);
  log('info', `plaintextPassword removed: ${stats.totalCleanedUp}${DRY_RUN ? ' (dry run)' : ''}`);
  log('info', `Errors:                 ${stats.totalErrors}`);
  
  if (stats.errors.length > 0) {
    log('info', '');
    log('error', 'Error details:');
    stats.errors.forEach((e, i) => {
      log('error', `  ${i + 1}. ${e.email || e.db}: ${e.error}`);
    });
  }
  
  if (DRY_RUN) {
    log('info', '');
    log('info', '⚠️  This was a DRY RUN. No changes were made.');
    log('info', '   To execute: DRY_RUN=false node scripts/migrate-plaintext-passwords.js');
  }
  
  log('info', '══════════════════════════════════════════════════════════════');
  
  process.exit(stats.totalErrors > 0 ? 1 : 0);
}

main();
