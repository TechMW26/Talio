/**
 * Migration Script: Disable All Statutory Deductions by Default
 * 
 * This script updates all existing employees to have:
 * - PF: not enrolled (enrolled = false)
 * - ESI: not enrolled (enrolled = false)
 * - PT: not applicable (applicable = false, amount = 0)
 * - TDS: disabled (enabled = false, percentage = 0, fixedAmount = 0)
 * 
 * Run with: node scripts/disable-statutory-deductions.js
 */

const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function migrateStatutoryDeductions() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    // Get all databases
    const adminDb = client.db().admin();
    const { databases } = await adminDb.listDatabases();
    
    // Filter tenant databases (talio_company_*)
    const tenantDatabases = databases
      .map(db => db.name)
      .filter(name => name.startsWith('talio_company_'));
    
    console.log(`📦 Found ${tenantDatabases.length} tenant database(s):\n`);
    tenantDatabases.forEach(db => console.log(`   - ${db}`));
    console.log('');
    
    let totalUpdated = 0;
    
    for (const dbName of tenantDatabases) {
      console.log(`\n🔄 Processing database: ${dbName}`);
      const db = client.db(dbName);
      
      // Update all employees to disable statutory deductions
      const result = await db.collection('employees').updateMany(
        {}, // Match all employees
        {
          $set: {
            // PF: Not enrolled
            'pfEnrollment.enrolled': false,
            // ESI: Not enrolled  
            'esiEnrollment.enrolled': false,
            // PT: Not applicable, amount = 0
            'professionalTax.applicable': false,
            'professionalTax.amount': 0,
            // TDS: Disabled, 0%
            'tdsConfiguration.enabled': false,
            'tdsConfiguration.percentage': 0,
            'tdsConfiguration.fixedAmount': 0,
          }
        }
      );
      
      console.log(`   ✅ Updated ${result.modifiedCount} employees in ${dbName}`);
      totalUpdated += result.modifiedCount;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 Migration Summary:');
    console.log(`   Total Databases: ${tenantDatabases.length}`);
    console.log(`   Total Employees Updated: ${totalUpdated}`);
    console.log('='.repeat(60));
    console.log('\n✅ Migration completed successfully!');
    console.log('   All employees now have PF, ESI, PT, TDS set to 0/disabled.');
    console.log('   These can be manually enabled per employee as needed.');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the migration
migrateStatutoryDeductions().catch(console.error);
