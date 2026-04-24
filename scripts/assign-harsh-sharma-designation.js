/**
 * One-time script: create "Assistant Director" designation (L5) and assign it
 * to Harsh Sharma in all tenant databases where they exist.
 *
 * Run: node scripts/assign-harsh-sharma-designation.js
 * Dry-run: DRY_RUN=true node scripts/assign-harsh-sharma-designation.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const DRY_RUN = process.env.DRY_RUN === 'true';
const log = (...a) => console.log('[HARSH-SHARMA]', ...a);

// ── Schemas (minimal, matching tenant models) ───────────────────────────────

const DesignationSchema = new mongoose.Schema({
  title: String,
  code: String,
  level: Number,
  levelName: String,
  isActive: { type: Boolean, default: true },
  description: String,
}, { timestamps: true });

const EmployeeSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
  designationLevel: Number,
  designationLevelName: String,
}, { timestamps: true });

// ── Main ────────────────────────────────────────────────────────────────────

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) { console.error('MONGODB_URI not set'); process.exit(1); }

async function processDatabase(uri, dbName) {
  const conn = await mongoose.createConnection(uri, {
    dbName,
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();

  const Designation = conn.model('Designation', DesignationSchema);
  const Employee    = conn.model('Employee',    EmployeeSchema);

  // Find Harsh Sharma (case-insensitive)
  const harshList = await Employee.find({
    firstName: /^harsh$/i,
    lastName:  /^sharma$/i,
  }).lean();

  if (!harshList.length) {
    log(`  ${dbName}: Harsh Sharma not found, skipping.`);
    await conn.close();
    return;
  }

  log(`  ${dbName}: Found ${harshList.length} match(es) for Harsh Sharma.`);

  // Find or create "Assistant Director" designation
  let desig = await Designation.findOne({ title: /^assistant\s*director$/i }).lean();

  if (!desig) {
    log(`  ${dbName}: Creating "Assistant Director" designation (L5)...`);
    if (!DRY_RUN) {
      const created = await Designation.create({
        title: 'Assistant Director',
        code: 'ASST-DIRECTOR',
        level: 5,
        levelName: 'Manager',
        isActive: true,
        description: 'Assistant Director — reports to Director level',
      });
      desig = created.toObject();
      log(`  ${dbName}: Created designation id=${desig._id}`);
    } else {
      log(`  ${dbName}: [DRY_RUN] Would create "Assistant Director" designation.`);
      desig = { _id: 'DRY_RUN_ID', level: 5, levelName: 'Manager', title: 'Assistant Director' };
    }
  } else {
    log(`  ${dbName}: Found existing designation "${desig.title}" (L${desig.level}) id=${desig._id}`);
  }

  // Assign to each Harsh Sharma found
  for (const emp of harshList) {
    log(`  ${dbName}: Assigning to ${emp.firstName} ${emp.lastName} (id=${emp._id})...`);
    if (!DRY_RUN) {
      await Employee.updateOne(
        { _id: emp._id },
        {
          $set: {
            designation: desig._id,
            designationLevel: desig.level,
            designationLevelName: desig.levelName,
          },
        }
      );
      log(`  ${dbName}: ✔ Updated.`);
    } else {
      log(`  ${dbName}: [DRY_RUN] Would assign designation to ${emp.firstName} ${emp.lastName}.`);
    }
  }

  await conn.close();
}

async function main() {
  log('─'.repeat(50));
  log(DRY_RUN ? 'Mode: DRY RUN' : 'Mode: ⚠️  LIVE');
  log('─'.repeat(50));

  // Enumerate tenant databases from the cluster
  const adminConn = await mongoose.createConnection(mongoUri, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();

  const adminDb  = adminConn.getClient().db().admin();
  const dbList   = await adminDb.listDatabases();
  const tenantDbs = dbList.databases.map(d => d.name).filter(n => /^talio_company_/i.test(n));

  // Also check talio_superadmin tenants collection
  try {
    const superDb = adminConn.getClient().db('talio_superadmin');
    const tenants = await superDb.collection('tenants').find({ isActive: { $ne: false } }).project({ databaseName: 1 }).toArray();
    for (const t of tenants) {
      if (t.databaseName && !tenantDbs.includes(t.databaseName)) tenantDbs.push(t.databaseName);
    }
  } catch (_) {}

  await adminConn.close();

  log(`Found ${tenantDbs.length} tenant DB(s): ${tenantDbs.join(', ')}`);

  for (const dbName of tenantDbs) {
    log(`→ ${dbName}`);
    await processDatabase(mongoUri, dbName);
  }

  log('─'.repeat(50));
  log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
