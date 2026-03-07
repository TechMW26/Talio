/**
 * Verification Script: Assert no plaintextPassword fields remain
 * 
 * Run after migration to verify all plaintext passwords have been removed.
 * 
 * USAGE:
 *   node scripts/verify-no-plaintext-passwords.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

function log(level, message) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [VERIFY] [${level.toUpperCase()}]`;
    if (level === 'error') {
        console.error(`${prefix} ${message}`);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

async function verifyDatabase(uri, dbName) {
    let connection;
    try {
        connection = await mongoose.createConnection(uri, {
            dbName,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 10000,
        }).asPromise();

        const usersCollection = connection.collection('users');

        // Check for any documents with plaintextPassword
        const withPlaintext = await usersCollection.countDocuments({
            plaintextPassword: { $exists: true },
        });

        // Check for documents with non-null plaintextPassword
        const withNonNullPlaintext = await usersCollection.countDocuments({
            plaintextPassword: { $exists: true, $ne: null, $ne: '' },
        });

        // Count documents with the new encrypted field
        const withEncrypted = await usersCollection.countDocuments({
            encryptedOnboardingPassword: { $exists: true, $ne: null },
        });

        // Total users
        const totalUsers = await usersCollection.countDocuments({});

        const passed = withPlaintext === 0;
        const symbol = passed ? '✅' : '❌';

        log('info', `${symbol} Database: ${dbName}`);
        log('info', `   Total users:                    ${totalUsers}`);
        log('info', `   With plaintextPassword field:    ${withPlaintext} ${withPlaintext > 0 ? '⚠️ VULNERABILITY' : '✓ Clean'}`);
        log('info', `   With non-null plaintext value:   ${withNonNullPlaintext}`);
        log('info', `   With encrypted onboarding pwd:   ${withEncrypted}`);

        return { dbName, totalUsers, withPlaintext, withNonNullPlaintext, withEncrypted, passed };
    } catch (error) {
        log('error', `Failed to verify database ${dbName}: ${error.message}`);
        return { dbName, error: error.message, passed: false };
    } finally {
        if (connection) await connection.close();
    }
}

async function main() {
    log('info', '══════════════════════════════════════════════════════════════');
    log('info', 'Plaintext Password Verification Script');
    log('info', '══════════════════════════════════════════════════════════════');

    const mongoUri = process.env.SUPERADMIN_DB_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
        log('error', 'SUPERADMIN_DB_URI or MONGODB_URI required');
        process.exit(1);
    }

    // Build explicit superadmin URI
    const uriMatch = mongoUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
    if (!uriMatch) {
        log('error', 'Invalid MONGODB_URI format');
        process.exit(1);
    }
    const clusterBase = uriMatch[1];
    const uriOptions = uriMatch[3] || '';
    const superadminUri = `${clusterBase}/talio_superadmin${uriOptions}`;

    // Discover tenants
    const connection = await mongoose.createConnection(superadminUri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
        family: 4,
    }).asPromise();

    let tenants = [];
    try {
        const tenantCompanies = connection.collection('tenantcompanies');
        tenants = await tenantCompanies.find(
            { isActive: true },
            { projection: { databaseName: 1, name: 1 } }
        ).toArray();
    } finally {
        await connection.close();
    }

    log('info', `Found ${tenants.length} tenant databases to verify`);
    log('info', '');

    const results = [];
    for (const tenant of tenants) {
        const result = await verifyDatabase(mongoUri, tenant.databaseName);
        results.push(result);
    }

    // Summary
    log('info', '');
    log('info', '══════════════════════════════════════════════════════════════');
    log('info', 'VERIFICATION SUMMARY');
    log('info', '══════════════════════════════════════════════════════════════');

    const allPassed = results.every(r => r.passed);
    const totalVulnerable = results.reduce((sum, r) => sum + (r.withPlaintext || 0), 0);
    const totalEncrypted = results.reduce((sum, r) => sum + (r.withEncrypted || 0), 0);

    log('info', `Databases verified:     ${results.length}`);
    log('info', `All clean:              ${allPassed ? '✅ YES' : '❌ NO'}`);
    log('info', `Total with plaintext:   ${totalVulnerable}`);
    log('info', `Total with encrypted:   ${totalEncrypted}`);

    if (!allPassed) {
        log('error', '');
        log('error', '⚠️  VULNERABILITY DETECTED: Some documents still contain plaintextPassword!');
        log('error', '   Run the migration script: DRY_RUN=false node scripts/migrate-plaintext-passwords.js');
        process.exit(1);
    } else {
        log('info', '');
        log('info', '🔒 All databases are clean. No plaintext passwords found.');
    }

    process.exit(0);
}

main();
