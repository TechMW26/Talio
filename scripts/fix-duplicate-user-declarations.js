#!/usr/bin/env node
/**
 * Script to fix duplicate 'user' variable declarations in API routes
 * 
 * The migration to getAuthAndModels introduced a pattern where:
 * 1. `const { user, models } = auth` - first declaration from auth
 * 2. `const user = await User.findById(...)` - second declaration (duplicate!)
 * 
 * This script fixes by:
 * 1. Changing `const { user, models } = auth` to `const { models } = auth`
 * 2. Keeping the second `const user = await ...` as the actual user fetch
 */

const fs = require('fs');
const path = require('path');

const filesToFix = [
  'app/api/announcements/route.js',
  'app/api/attendance/corrections/route.js',
  'app/api/attendance/overtime/route.js',
  'app/api/employees/[id]/route.js',
  'app/api/geofence/locations/[id]/route.js',
  'app/api/geofence/locations/route.js',
  'app/api/meetings/[id]/route.js',
  'app/api/meetings/[id]/summary/route.js',
  'app/api/meetings/[id]/transcript/route.js',
  'app/api/meetings/route.js',
  'app/api/productivity/sessions/[id]/analyze/route.js',
  'app/api/productivity/sessions/route.js',
  'app/api/profile/aadhaar-upload/route.js',
  'app/api/profile/picture/route.js',
  'app/api/profile/route.js',
  'app/api/profile/verify-aadhaar/route.js',
  'app/api/projects/[projectId]/analytics/route.js',
  'app/api/projects/[projectId]/approval/route.js',
  'app/api/projects/[projectId]/complete/route.js',
  'app/api/projects/[projectId]/members/route.js',
  'app/api/projects/[projectId]/notes/[noteId]/route.js',
  'app/api/projects/[projectId]/notes/route.js',
  'app/api/projects/[projectId]/respond/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/assignees/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/delete-request/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/deletion-response/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/reassign/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/respond/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/subtasks/[subtaskId]/comments/route.js',
  'app/api/projects/[projectId]/tasks/[taskId]/subtasks/route.js',
  'app/api/projects/[projectId]/tasks/route.js',
  'app/api/projects/[projectId]/timeline/route.js',
  'app/api/projects/approvals/[requestId]/route.js',
  'app/api/projects/approvals/[requestId]/task-completion/route.js',
  'app/api/projects/approvals/route.js',
  'app/api/projects/assigned-tasks/route.js',
  'app/api/projects/route.js',
  'app/api/search/route.js',
  'app/api/settings/screenshot-interval/route.js',
  'app/api/team/leave-approvals/route.js',
  'app/api/team/members/[id]/route.js',
  'app/api/team/members/route.js',
  'app/api/team/pending-requests/route.js',
  'app/api/upload/route.js',
  'app/api/users/search/route.js',
  'app/api/whiteboard/[id]/analyze/route.js',
  'app/api/whiteboard/[id]/route.js',
  'app/api/whiteboard/[id]/share/route.js',
  'app/api/whiteboard/route.js',
];

let totalFixed = 0;
let totalErrors = 0;

for (const relPath of filesToFix) {
  const filePath = path.join(process.cwd(), relPath);
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ File not found: ${relPath}`);
      continue;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Pattern 1: Remove 'user' from the destructure if followed by another const user
    // Change: const { user, models } = auth
    // To:     const { models } = auth
    const pattern1 = /const\s*\{\s*user\s*,\s*models\s*\}\s*=\s*auth/g;
    if (pattern1.test(content)) {
      content = content.replace(pattern1, 'const { models } = auth');
      modified = true;
    }
    
    // Also handle: const { user, models } = auth;
    const pattern1b = /const\s*\{\s*user\s*,\s*models\s*\}\s*=\s*auth;/g;
    if (pattern1b.test(content)) {
      content = content.replace(pattern1b, 'const { models } = auth;');
      modified = true;
    }
    
    // Pattern 2: Fix User1 references that should be User
    // Some files have User aliased as User1 due to migration issues
    const pattern2 = /await\s+User1\.findById/g;
    if (pattern2.test(content)) {
      content = content.replace(pattern2, 'await User.findById');
      modified = true;
    }
    
    // Also fix User1.findOne, etc
    const pattern2b = /User1\./g;
    if (pattern2b.test(content)) {
      content = content.replace(pattern2b, 'User.');
      modified = true;
    }
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Fixed: ${relPath}`);
      totalFixed++;
    } else {
      console.log(`ℹ️ No changes needed: ${relPath}`);
    }
    
  } catch (error) {
    console.error(`❌ Error fixing ${relPath}:`, error.message);
    totalErrors++;
  }
}

console.log(`\n=== Summary ===`);
console.log(`Files fixed: ${totalFixed}`);
console.log(`Errors: ${totalErrors}`);
console.log(`Total files: ${filesToFix.length}`);
