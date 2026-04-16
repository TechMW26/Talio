/**
 * Migration Script: ImageKit → MongoDB GridFS
 *
 * Downloads images currently stored in ImageKit and uploads them to MongoDB GridFS,
 * then updates the corresponding document fields with the new GridFS URL.
 *
 * Scope: ALL image types EXCEPT screenshots (as requested).
 *
 * Models migrated:
 *   - User: avatar + aadhaarFront/aadhaarBack
 *   - Employee: profilePicture + documents[].url
 *   - Company: logo
 *   - SystemPreferences: companyLogo
 *   - Whiteboard: thumbnail
 *   - Document: fileUrl
 *   - Chat messages: fileUrl
 *   - Course: thumbnail
 *
 * Run:      node scripts/migrate-imagekit-to-gridfs.js
 * Dry run:  node scripts/migrate-imagekit-to-gridfs.js --dry-run
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');

// ── MongoDB helpers ──────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;

function getClusterBaseUri() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  if (!match) throw new Error('Invalid MONGODB_URI format');
  return { baseUri: match[1], options: match[3] || '' };
}

function getDatabaseUri(databaseName) {
  const { baseUri, options } = getClusterBaseUri();
  return `${baseUri}/${databaseName}${options}`;
}

// ── GridFS helpers ───────────────────────────────────────────────────────────

function getImagesBucket(db) {
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'images' });
}

async function uploadToGridFS(db, buffer, filename, contentType, metadata = {}) {
  const bucket = getImagesBucket(db);
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, {
      contentType,
      metadata
    });
    stream.on('error', reject);
    stream.on('finish', () => {
      resolve({
        _id: stream.id,
        url: `/api/images/${stream.id}`
      });
    });
    stream.end(buffer);
  });
}

// ── Download helper ──────────────────────────────────────────────────────────

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}

function isImageKitUrl(url) {
  return url && typeof url === 'string' && url.includes('ik.imagekit.io');
}

// ── Schema definitions (minimal) ─────────────────────────────────────────────

const TenantCompanySchema = new mongoose.Schema({
  name: String,
  slug: String,
  databaseName: String,
  isActive: Boolean,
}, { strict: false });

// Use strict: false so we can read/update any field without full schema definitions

// ── Migration functions ──────────────────────────────────────────────────────

async function migrateCollection(conn, collectionName, findQuery, urlField, fileIdField, category, label) {
  const db = conn.db;
  const collection = db.collection(collectionName);
  const docs = await collection.find(findQuery).toArray();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const url = doc[urlField];
    if (!isImageKitUrl(url)) {
      skipped++;
      continue;
    }

    try {
      if (DRY_RUN) {
        console.log(`  [DRY] Would migrate ${label} ${doc._id}: ${url.substring(0, 80)}...`);
        migrated++;
        continue;
      }

      const { buffer, contentType } = await downloadImage(url);
      const filename = `${category}_${doc._id}_${Date.now()}`;
      const result = await uploadToGridFS(db, buffer, filename, contentType, { category, originalUrl: url });

      const updateFields = {
        [urlField]: result.url,
        [fileIdField]: String(result._id)
      };

      await collection.updateOne({ _id: doc._id }, { $set: updateFields });
      migrated++;

      if (migrated % 50 === 0) {
        console.log(`  [${label}] Progress: ${migrated} migrated`);
      }
    } catch (err) {
      console.error(`  [${label}] Failed ${doc._id}: ${err.message}`);
      failed++;
    }
  }

  return { total: docs.length, migrated, skipped, failed };
}

async function migrateSubdocuments(conn, collectionName, parentQuery, arrayField, urlSubField, fileIdSubField, category, label) {
  const db = conn.db;
  const collection = db.collection(collectionName);
  const docs = await collection.find(parentQuery).toArray();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const items = doc[arrayField];
    if (!Array.isArray(items) || items.length === 0) continue;

    let changed = false;
    for (let i = 0; i < items.length; i++) {
      const url = items[i][urlSubField];
      if (!isImageKitUrl(url)) {
        skipped++;
        continue;
      }

      try {
        if (DRY_RUN) {
          console.log(`  [DRY] Would migrate ${label} ${doc._id}[${i}]: ${url.substring(0, 80)}...`);
          migrated++;
          continue;
        }

        const { buffer, contentType } = await downloadImage(url);
        const filename = `${category}_${doc._id}_${i}_${Date.now()}`;
        const result = await uploadToGridFS(db, buffer, filename, contentType, { category, originalUrl: url });

        items[i][urlSubField] = result.url;
        items[i][fileIdSubField] = String(result._id);
        changed = true;
        migrated++;
      } catch (err) {
        console.error(`  [${label}] Failed ${doc._id}[${i}]: ${err.message}`);
        failed++;
      }
    }

    if (changed && !DRY_RUN) {
      await collection.updateOne({ _id: doc._id }, { $set: { [arrayField]: items } });
    }
  }

  return { total: docs.length, migrated, skipped, failed };
}

async function migrateEmbeddedFields(conn, collectionName, parentQuery, fieldPaths, category, label) {
  // fieldPaths: [{ urlPath: 'profileCompletion.aadhaarFront.url', fileIdPath: 'profileCompletion.aadhaarFront.fileId' }]
  const db = conn.db;
  const collection = db.collection(collectionName);
  const docs = await collection.find(parentQuery).toArray();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const updateFields = {};
    let docChanged = false;

    for (const { urlPath, fileIdPath } of fieldPaths) {
      const url = getNestedValue(doc, urlPath);
      if (!isImageKitUrl(url)) {
        skipped++;
        continue;
      }

      try {
        if (DRY_RUN) {
          console.log(`  [DRY] Would migrate ${label} ${doc._id}.${urlPath}: ${url.substring(0, 80)}...`);
          migrated++;
          continue;
        }

        const { buffer, contentType } = await downloadImage(url);
        const fieldName = urlPath.split('.').pop();
        const filename = `${category}_${doc._id}_${fieldName}_${Date.now()}`;
        const result = await uploadToGridFS(db, buffer, filename, contentType, { category, originalUrl: url });

        updateFields[urlPath] = result.url;
        updateFields[fileIdPath] = String(result._id);
        docChanged = true;
        migrated++;
      } catch (err) {
        console.error(`  [${label}] Failed ${doc._id}.${urlPath}: ${err.message}`);
        failed++;
      }
    }

    if (docChanged && !DRY_RUN) {
      await collection.updateOne({ _id: doc._id }, { $set: updateFields });
    }
  }

  return { total: docs.length, migrated, skipped, failed };
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// ── Tenant migration ─────────────────────────────────────────────────────────

async function migrateTenant(tenantConn, tenantName) {
  console.log(`\n[${tenantName}] Starting migration...`);
  const results = {};

  // 1. Users: avatar
  console.log(`[${tenantName}] Migrating User avatars...`);
  results.userAvatars = await migrateCollection(
    tenantConn, 'users',
    { avatar: { $regex: /ik\.imagekit\.io/ } },
    'avatar', 'avatarFileId', 'profile', 'User.avatar'
  );

  // 2. Users: aadhaar documents
  console.log(`[${tenantName}] Migrating User aadhaar documents...`);
  results.userAadhaar = await migrateEmbeddedFields(
    tenantConn, 'users',
    { $or: [
      { 'profileCompletion.aadhaarFront.url': { $regex: /ik\.imagekit\.io/ } },
      { 'profileCompletion.aadhaarBack.url': { $regex: /ik\.imagekit\.io/ } }
    ]},
    [
      { urlPath: 'profileCompletion.aadhaarFront.url', fileIdPath: 'profileCompletion.aadhaarFront.fileId' },
      { urlPath: 'profileCompletion.aadhaarBack.url', fileIdPath: 'profileCompletion.aadhaarBack.fileId' }
    ],
    'aadhaar', 'User.aadhaar'
  );

  // 3. Employees: profilePicture
  console.log(`[${tenantName}] Migrating Employee profile pictures...`);
  results.employeePhotos = await migrateCollection(
    tenantConn, 'employees',
    { profilePicture: { $regex: /ik\.imagekit\.io/ } },
    'profilePicture', 'profilePictureFileId', 'profile', 'Employee.profilePicture'
  );

  // 4. Employees: documents array
  console.log(`[${tenantName}] Migrating Employee document attachments...`);
  results.employeeDocs = await migrateSubdocuments(
    tenantConn, 'employees',
    { 'documents.url': { $regex: /ik\.imagekit\.io/ } },
    'documents', 'url', 'fileId', 'document', 'Employee.documents'
  );

  // 5. Companies: logo
  console.log(`[${tenantName}] Migrating Company logos...`);
  results.companyLogos = await migrateCollection(
    tenantConn, 'companies',
    { logo: { $regex: /ik\.imagekit\.io/ } },
    'logo', 'logoFileId', 'company', 'Company.logo'
  );

  // 6. SystemPreferences: companyLogo
  console.log(`[${tenantName}] Migrating SystemPreferences logos...`);
  results.systemLogos = await migrateCollection(
    tenantConn, 'systempreferences',
    { companyLogo: { $regex: /ik\.imagekit\.io/ } },
    'companyLogo', 'companyLogoFileId', 'settings', 'SystemPreferences.companyLogo'
  );

  // 7. Whiteboards: thumbnail
  console.log(`[${tenantName}] Migrating Whiteboard thumbnails...`);
  results.whiteboards = await migrateCollection(
    tenantConn, 'whiteboards',
    { thumbnail: { $regex: /ik\.imagekit\.io/ } },
    'thumbnail', 'thumbnailFileId', 'whiteboard', 'Whiteboard.thumbnail'
  );

  // 8. Documents: fileUrl
  console.log(`[${tenantName}] Migrating Document files...`);
  results.documents = await migrateCollection(
    tenantConn, 'documents',
    { fileUrl: { $regex: /ik\.imagekit\.io/ } },
    'fileUrl', 'fileId', 'document', 'Document.fileUrl'
  );

  // 9. Courses: thumbnail
  console.log(`[${tenantName}] Migrating Course thumbnails...`);
  results.courses = await migrateCollection(
    tenantConn, 'courses',
    { thumbnail: { $regex: /ik\.imagekit\.io/ } },
    'thumbnail', 'thumbnailFileId', 'course', 'Course.thumbnail'
  );

  // 10. Chat messages: fileUrl (in messages array)
  console.log(`[${tenantName}] Migrating Chat message attachments...`);
  results.chatMessages = await migrateSubdocuments(
    tenantConn, 'chats',
    { 'messages.fileUrl': { $regex: /ik\.imagekit\.io/ } },
    'messages', 'fileUrl', 'fileId', 'chat', 'Chat.messages'
  );

  // Print summary for this tenant
  console.log(`\n[${tenantName}] Migration summary:`);
  let totalMigrated = 0;
  let totalFailed = 0;
  for (const [key, val] of Object.entries(results)) {
    if (val.migrated > 0 || val.failed > 0) {
      console.log(`  ${key}: ${val.migrated} migrated, ${val.skipped} skipped, ${val.failed} failed (${val.total} docs checked)`);
    }
    totalMigrated += val.migrated;
    totalFailed += val.failed;
  }
  console.log(`[${tenantName}] Total: ${totalMigrated} migrated, ${totalFailed} failed`);

  return { tenant: tenantName, totalMigrated, totalFailed, details: results };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ImageKit → GridFS Migration Script');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '📦 LIVE (will migrate images)'}`);
  console.log('  Scope: All images EXCEPT screenshots');
  console.log('═══════════════════════════════════════════════════════\n');

  const superadminUri = getDatabaseUri('talio_superadmin');
  const superadminConn = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 10000,
    family: 4,
  }).asPromise();

  console.log('Connected to superadmin DB');

  const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema);
  const tenants = await TenantCompany.find({ isActive: true }).select('name slug databaseName').lean();

  console.log(`Found ${tenants.length} active tenant(s):\n`);
  for (const t of tenants) {
    console.log(`  - ${t.name} (${t.databaseName})`);
  }

  const allResults = [];

  for (const tenant of tenants) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Processing: ${tenant.name} (${tenant.databaseName})`);
    console.log('─'.repeat(60));

    let tenantConn;
    try {
      const tenantUri = getDatabaseUri(tenant.databaseName);
      tenantConn = await mongoose.createConnection(tenantUri, {
        maxPoolSize: 10,
        socketTimeoutMS: 120000,
        connectTimeoutMS: 15000,
        family: 4,
      }).asPromise();

      const result = await migrateTenant(tenantConn, tenant.name);
      allResults.push(result);
    } catch (err) {
      console.error(`[${tenant.name}] ❌ Error:`, err.message);
      allResults.push({ tenant: tenant.name, error: err.message });
    } finally {
      if (tenantConn) await tenantConn.close();
    }
  }

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  MIGRATION SUMMARY');
  console.log('═'.repeat(60));

  let grandTotalMigrated = 0;
  let grandTotalFailed = 0;

  for (const r of allResults) {
    if (r.error) {
      console.log(`  ❌ ${r.tenant}: ERROR - ${r.error}`);
    } else {
      console.log(`  ${r.totalMigrated > 0 ? '📦' : '✅'} ${r.tenant}: ${r.totalMigrated} migrated, ${r.totalFailed} failed`);
      grandTotalMigrated += r.totalMigrated;
      grandTotalFailed += r.totalFailed;
    }
  }

  console.log(`\n  GRAND TOTAL: ${grandTotalMigrated} images migrated, ${grandTotalFailed} failed`);

  await superadminConn.close();
  console.log('\nDone. All connections closed.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
