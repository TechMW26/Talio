import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';
import connectDB from '@/lib/mongodb';

/**
 * Sync department head status to User meta
 * This function updates the isDepartmentHead flag and headOfDepartments array
 * for users based on their assignment in Department.heads or Department.head
 * 
 * @param {string|null} employeeId - If provided, only sync for this employee. If null, sync all.
 * @returns {Promise<{success: boolean, updated: number, message: string}>}
 */
export async function syncDepartmentHeadStatus(employeeId = null) {
  try {
    await connectDB();

    // Get all active departments
    const departments = await Department.find({ isActive: true }).lean();

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
    }

    let updatedCount = 0;

    if (employeeId) {
      // Sync only for specific employee
      const employee = await Employee.findById(employeeId).lean();
      if (!employee) {
        return { success: false, updated: 0, message: 'Employee not found' };
      }

      const user = await User.findOne({ employeeId: employee._id });
      if (!user) {
        return { success: false, updated: 0, message: 'User not found for employee' };
      }

      const deptIds = headMap.get(employeeId.toString());
      const isDepartmentHead = deptIds && deptIds.size > 0;
      const headOfDepartments = isDepartmentHead ? Array.from(deptIds) : [];

      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            isDepartmentHead,
            headOfDepartments
          }
        }
      );
      updatedCount = 1;
    } else {
      // Sync all users
      // First, get all employees who are heads
      const allEmployeeIds = Array.from(headMap.keys());

      // Reset all users to not be department heads
      await User.updateMany(
        {},
        {
          $set: {
            isDepartmentHead: false,
            headOfDepartments: []
          }
        }
      );

      // Update users who are department heads
      for (const [empId, deptIds] of headMap) {
        const user = await User.findOne({ employeeId: empId });
        if (user) {
          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                isDepartmentHead: true,
                headOfDepartments: Array.from(deptIds)
              }
            }
          );
          updatedCount++;
        }
      }
    }

    return {
      success: true,
      updated: updatedCount,
      message: `Successfully synced ${updatedCount} user(s) department head status`
    };
  } catch (error) {
    console.error('[DepartmentHeadSync] Error:', error);
    return {
      success: false,
      updated: 0,
      message: error.message
    };
  }
}

/**
 * Update department head status for all heads in a specific department
 * Call this when a department's heads are updated
 * 
 * @param {string} departmentId - The department ID
 * @param {string[]} previousHeads - Array of previous head employee IDs (before update)
 * @param {string[]} newHeads - Array of new head employee IDs (after update)
 */
export async function updateDepartmentHeadsForDepartment(departmentId, previousHeads = [], newHeads = []) {
  try {
    await connectDB();

    // Normalize to strings
    const prevHeadSet = new Set((previousHeads || []).map(h => h.toString()));
    const newHeadSet = new Set((newHeads || []).map(h => h.toString()));

    // Find employees who were removed as heads
    const removedHeads = [...prevHeadSet].filter(h => !newHeadSet.has(h));
    
    // Find employees who were added as heads
    const addedHeads = [...newHeadSet].filter(h => !prevHeadSet.has(h));

    // For removed heads, we need to re-sync their entire status
    // (they might still be head of other departments)
    for (const empId of removedHeads) {
      await syncDepartmentHeadStatus(empId);
    }

    // For added heads, we need to add this department to their list
    for (const empId of addedHeads) {
      const user = await User.findOne({ employeeId: empId });
      if (user) {
        // Get all departments where this employee is head
        const departments = await Department.find({
          isActive: true,
          $or: [
            { head: empId },
            { heads: empId }
          ]
        }).select('_id').lean();

        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              isDepartmentHead: departments.length > 0,
              headOfDepartments: departments.map(d => d._id)
            }
          }
        );
      }
    }

    console.log(`[DepartmentHeadSync] Updated heads for department ${departmentId}. Removed: ${removedHeads.length}, Added: ${addedHeads.length}`);
    
    return { success: true };
  } catch (error) {
    console.error('[DepartmentHeadSync] Error updating department heads:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Get all department heads with their department info
 * Useful for admin views
 */
export async function getAllDepartmentHeads() {
  try {
    await connectDB();

    const users = await User.find({
      isDepartmentHead: true,
      isActive: true
    })
      .populate('employeeId', 'firstName lastName employeeCode email profilePicture')
      .populate('headOfDepartments', 'name code')
      .lean();

    return {
      success: true,
      data: users.map(u => ({
        userId: u._id,
        email: u.email,
        role: u.role,
        employee: u.employeeId,
        departments: u.headOfDepartments
      }))
    };
  } catch (error) {
    console.error('[DepartmentHeadSync] Error getting department heads:', error);
    return { success: false, data: [], message: error.message };
  }
}
