/**
 * Migration script to sync department head status for all existing users
 * 
 * This script reads all departments and updates User documents with:
 * - isDepartmentHead: true/false
 * - headOfDepartments: [departmentId, ...]
 * 
 * Run with: node scripts/sync-department-heads.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not found in environment variables');
  process.exit(1);
}

// Import models after dotenv
const User = (await import('../models/User.js')).default;
const Employee = (await import('../models/Employee.js')).default;
const Department = (await import('../models/Department.js')).default;

async function syncDepartmentHeads() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all active departments
    const departments = await Department.find({ isActive: true }).lean();
    console.log(`Found ${departments.length} active departments`);

    // Build a map of employeeId -> departmentIds where they are head
    const headMap = new Map(); // employeeId -> Set of departmentIds

    for (const dept of departments) {
      // Collect all heads from both legacy and new fields
      const allHeads = new Set();
      
      if (dept.head) {
        allHeads.add(dept.head.toString());
      }
      
      if (dept.heads && dept.heads.length > 0) {
        dept.heads.forEach(h => allHeads.add(h.toString()));
      }

      // Add to headMap
      for (const empId of allHeads) {
        if (!headMap.has(empId)) {
          headMap.set(empId, new Set());
        }
        headMap.get(empId).add(dept._id.toString());
      }

      if (allHeads.size > 0) {
        console.log(`Department "${dept.name}" has ${allHeads.size} head(s)`);
      }
    }

    console.log(`\nFound ${headMap.size} unique department heads`);

    // First, reset all users to not be department heads
    const resetResult = await User.updateMany(
      {},
      {
        $set: {
          isDepartmentHead: false,
          headOfDepartments: []
        }
      }
    );
    console.log(`Reset ${resetResult.modifiedCount} users`);

    // Update users who are department heads
    let updatedCount = 0;
    for (const [empId, deptIds] of headMap) {
      const user = await User.findOne({ employeeId: empId });
      if (user) {
        const deptIdArray = Array.from(deptIds);
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              isDepartmentHead: true,
              headOfDepartments: deptIdArray
            }
          }
        );
        
        // Get employee name for logging
        const employee = await Employee.findById(empId).select('firstName lastName').lean();
        const name = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
        console.log(`✓ Updated ${name} (${user.email}) - Head of ${deptIdArray.length} department(s)`);
        updatedCount++;
      } else {
        console.log(`⚠ No user found for employee ID: ${empId}`);
      }
    }

    console.log(`\n✅ Successfully synced ${updatedCount} department head(s)`);

    // List all department heads with their departments
    console.log('\n--- Department Heads Summary ---');
    const departmentHeads = await User.find({ isDepartmentHead: true })
      .populate('employeeId', 'firstName lastName employeeCode')
      .populate('headOfDepartments', 'name code')
      .lean();

    for (const head of departmentHeads) {
      const empName = head.employeeId 
        ? `${head.employeeId.firstName} ${head.employeeId.lastName}` 
        : 'Unknown';
      const deptNames = head.headOfDepartments?.map(d => d.name).join(', ') || 'None';
      console.log(`  ${empName} (${head.role}) -> Departments: ${deptNames}`);
    }

  } catch (error) {
    console.error('Error syncing department heads:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the migration
syncDepartmentHeads();
