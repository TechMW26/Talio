const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function fix() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('talio_company_mushroom_world_group');
  
  // Find employees with low salary values (likely truncated)
  const employees = await db.collection('employees').find({
    'salary.grossSalary': { $exists: true, $gt: 0, $lt: 1000 }
  }).toArray();
  
  console.log(`Fixing ${employees.length} employees with truncated salaries...\n`);
  
  for (const emp of employees) {
    const oldGross = emp.salary.grossSalary;
    const newGross = oldGross * 1000;
    
    // Recalculate salary breakdown
    const basic = Math.round(newGross * 0.40);
    const hra = Math.round(basic * 0.40);
    const conveyance = 800;
    const medical = Math.round(newGross * 0.05);
    const special = Math.max(0, newGross - basic - hra - conveyance - medical);
    
    const newSalary = {
      basic,
      hra,
      conveyance,
      medical,
      special,
      grossSalary: newGross,
      ctc: newGross * 12
    };
    
    await db.collection('employees').updateOne(
      { _id: emp._id },
      { $set: { salary: newSalary } }
    );
    
    console.log(`✓ ${emp.firstName} ${emp.lastName}: ₹${oldGross} → ₹${newGross}`);
  }
  
  console.log(`\n✅ Fixed ${employees.length} employees!`);
  
  await client.close();
}

fix().catch(console.error);
