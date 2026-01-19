/**
 * Rectify Truncated Salaries Script
 * 
 * This script fixes employee salaries that were truncated during bulk import
 * due to parseFloat failing on formatted numbers (e.g., "8,000" -> 8).
 * 
 * The issue was that parseFloat("8,000") returns 8 (stops at the comma).
 * 
 * Usage:
 *   node scripts/rectify-truncated-salaries.js [--dry-run] [--database=<db_name>]
 * 
 * Options:
 *   --dry-run     Preview changes without modifying the database
 *   --database    Specify the database name (default: talio_company_mushroom_world_group)
 */

const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbArg = args.find(arg => arg.startsWith('--database='));
const targetDatabase = dbArg ? dbArg.split('=')[1] : 'talio_company_mushroom_world_group';

console.log('='.repeat(60));
console.log('Truncated Salary Rectification Script');
console.log('='.repeat(60));
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update database)'}`);
console.log(`Target Database: ${targetDatabase}`);
console.log('='.repeat(60));

// Connect to MongoDB
const connectDB = async () => {
  try {
    // Build connection URI for specific database
    let uri = process.env.MONGODB_URI;
    
    // Replace the database name in the URI if specified
    if (targetDatabase) {
      // Handle both formats: mongodb://.../<db> and mongodb+srv://.../<db>
      uri = uri.replace(/\/[^/?]+(\?|$)/, `/${targetDatabase}$1`);
    }
    
    console.log(`Connecting to database: ${targetDatabase}...`);
    await mongoose.connect(uri);
    console.log('MongoDB Connected\n');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Define Employee Schema (simplified for script usage)
const EmployeeSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  employeeId: String,
  salary: {
    basic: Number,
    hra: Number,
    conveyance: Number,
    medical: Number,
    special: Number,
    grossSalary: Number,
    ctc: Number
  }
}, { strict: false });

/**
 * Detect if a salary value appears to be truncated
 * Returns the likely multiplier to restore the original value
 */
function detectTruncation(value) {
  if (!value || value <= 0) return null;
  
  // Very small values (1-999) are likely truncated
  // Real salaries in India are typically 3,000+ (minimum wage) to lakhs
  
  if (value >= 1 && value < 10) {
    // Single digit (8, 5, etc.) - likely truncated from thousands (8000, 5000)
    return { multiplier: 1000, confidence: 'high', reason: 'Single digit salary - likely truncated at first comma' };
  }
  
  if (value >= 10 && value < 100) {
    // Two digits (17, 40, 25) - could be truncated from thousands (17000, 40000, 25000)
    return { multiplier: 1000, confidence: 'high', reason: 'Two digit salary - likely truncated at first comma' };
  }
  
  if (value >= 100 && value < 1000) {
    // Three digits (100, 150, 800) - could be truncated from lakhs (100000, 150000, 800000)
    // But could also be legitimately low salaries in some rare cases
    // Check if it looks like a "clean" number that would result from truncation
    if (value % 10 === 0 || value % 25 === 0 || value % 5 === 0) {
      return { multiplier: 1000, confidence: 'medium', reason: 'Three digit salary - possibly truncated' };
    }
    return null; // Uncertain
  }
  
  // Values 1000+ are likely correct
  return null;
}

/**
 * Calculate corrected salary breakdown
 */
function calculateSalaryBreakdown(grossSalary) {
  const gross = grossSalary;
  if (gross <= 0) return null;
  
  const basic = Math.round(gross * 0.40);           // 40% of gross
  const hra = Math.round(basic * 0.40);             // 40% of basic (16% of gross)
  const conveyance = 800;                            // Fixed ₹800
  const medical = Math.round(gross * 0.05);         // 5% of gross
  const special = gross - basic - hra - conveyance - medical;  // Remainder

  return {
    basic,
    hra,
    conveyance,
    medical,
    special: Math.max(0, special),
    grossSalary: gross,
    ctc: gross * 12
  };
}

async function rectifySalaries() {
  await connectDB();
  
  const Employee = mongoose.model('Employee', EmployeeSchema);
  
  // Find all employees with salary data
  const employees = await Employee.find({
    'salary.grossSalary': { $exists: true, $gt: 0 }
  }).lean();
  
  console.log(`Found ${employees.length} employees with salary data\n`);
  
  const toFix = [];
  const alreadyCorrect = [];
  const uncertain = [];
  
  for (const emp of employees) {
    const grossSalary = emp.salary?.grossSalary;
    if (!grossSalary) continue;
    
    const detection = detectTruncation(grossSalary);
    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email || emp.employeeId;
    
    if (detection) {
      const correctedGross = grossSalary * detection.multiplier;
      toFix.push({
        _id: emp._id,
        name,
        employeeId: emp.employeeId,
        currentGross: grossSalary,
        correctedGross,
        multiplier: detection.multiplier,
        confidence: detection.confidence,
        reason: detection.reason
      });
    } else if (grossSalary < 1000) {
      uncertain.push({
        name,
        employeeId: emp.employeeId,
        grossSalary
      });
    } else {
      alreadyCorrect.push({
        name,
        employeeId: emp.employeeId,
        grossSalary
      });
    }
  }
  
  // Report findings
  console.log('=' .repeat(60));
  console.log('FINDINGS');
  console.log('='.repeat(60));
  
  console.log(`\n✅ Already correct (${alreadyCorrect.length} employees):`);
  if (alreadyCorrect.length <= 10) {
    alreadyCorrect.forEach(e => console.log(`   - ${e.name}: ₹${e.grossSalary.toLocaleString('en-IN')}`));
  } else {
    console.log(`   (showing first 10 of ${alreadyCorrect.length})`);
    alreadyCorrect.slice(0, 10).forEach(e => console.log(`   - ${e.name}: ₹${e.grossSalary.toLocaleString('en-IN')}`));
  }
  
  console.log(`\n⚠️  Uncertain (${uncertain.length} employees) - manual review recommended:`);
  uncertain.forEach(e => console.log(`   - ${e.name}: ₹${e.grossSalary}`));
  
  console.log(`\n🔧 To be fixed (${toFix.length} employees):`);
  toFix.forEach(e => {
    console.log(`   - ${e.name} (${e.employeeId || 'no ID'})`);
    console.log(`     Current: ₹${e.currentGross} → Corrected: ₹${e.correctedGross.toLocaleString('en-IN')}`);
    console.log(`     Confidence: ${e.confidence} | Reason: ${e.reason}`);
  });
  
  if (toFix.length === 0) {
    console.log('\n✅ No truncated salaries found. Nothing to fix.');
    await mongoose.disconnect();
    return;
  }
  
  // Apply fixes
  if (dryRun) {
    console.log('\n' + '='.repeat(60));
    console.log('DRY RUN - No changes made');
    console.log('Run without --dry-run to apply these changes');
    console.log('='.repeat(60));
  } else {
    console.log('\n' + '='.repeat(60));
    console.log('APPLYING FIXES...');
    console.log('='.repeat(60));
    
    let fixed = 0;
    let failed = 0;
    
    for (const emp of toFix) {
      try {
        const newSalary = calculateSalaryBreakdown(emp.correctedGross);
        
        await Employee.updateOne(
          { _id: emp._id },
          { $set: { salary: newSalary } }
        );
        
        console.log(`✅ Fixed: ${emp.name} - ₹${emp.currentGross} → ₹${emp.correctedGross.toLocaleString('en-IN')}`);
        fixed++;
      } catch (error) {
        console.error(`❌ Failed to fix ${emp.name}: ${error.message}`);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Fixed: ${fixed} employees`);
    console.log(`Failed: ${failed} employees`);
    console.log(`Skipped (uncertain): ${uncertain.length} employees`);
    console.log(`Already correct: ${alreadyCorrect.length} employees`);
  }
  
  await mongoose.disconnect();
  console.log('\nDone.');
}

// Run the script
rectifySalaries().catch(console.error);
