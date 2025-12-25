/**
 * Multi-Tenant Route Migration Script
 * 
 * This script automatically migrates API routes from using connectDB() and direct model imports
 * to using the tenant-aware getAuthAndModels() helper.
 * 
 * Usage: node scripts/migrate-routes-to-tenant.js [--dry-run] [--route=/api/path]
 * 
 * Options:
 *   --dry-run    Preview changes without writing to files
 *   --route=     Only migrate a specific route (e.g., --route=/api/attendance)
 *   --verbose    Show detailed output
 */

const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..', 'app', 'api');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const ROUTE_FILTER = args.find(a => a.startsWith('--route='))?.split('=')[1];

// Routes that should NOT be migrated (public routes, special handling, etc.)
const SKIP_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/google',
  '/api/auth/session',
  '/api/setup/',
  '/api/cron/',
  '/api/superadmin/',
  '/api/assetlinks',
  '/api/test-',
  '/api/socketio',
];

// Model import patterns to detect
const MODEL_IMPORTS = [
  'User', 'Employee', 'Department', 'Designation', 'Attendance', 'Leave',
  'LeaveType', 'LeaveBalance', 'Holiday', 'Company', 'CompanySettings',
  'UserSession', 'GeofenceLocation', 'GeofenceLog', 'AttendanceCorrection',
  'Notification', 'Project', 'Task', 'TaskAssignee', 'ProjectMember',
  'Chat', 'Expense', 'Payroll', 'Document', 'Asset', 'Announcement',
  'Helpdesk', 'Meeting', 'Policy', 'Performance', 'PerformanceGoal',
  'DailyGoal', 'Recruitment', 'Suggestion', 'Whiteboard', 'Activity',
  'ProductivitySession', 'CallAlert', 'PushSubscription',
  'ScheduledNotification', 'RecurringNotification', 'HealthScore',
  'ApprovalRequest', 'ProjectApprovalRequest', 'ProjectNote',
  'ProjectTimelineEvent', 'OvertimeRequest', 'OnboardingEmail',
];

// Stats
let stats = {
  scanned: 0,
  skipped: 0,
  migrated: 0,
  alreadyMigrated: 0,
  errors: 0,
};

function shouldSkip(routePath) {
  return SKIP_ROUTES.some(skip => routePath.startsWith(skip));
}

function findRouteFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...findRouteFiles(fullPath));
    } else if (item === 'route.js') {
      files.push(fullPath);
    }
  }
  
  return files;
}

function extractModelImports(content) {
  const models = new Set();
  
  // Match: import ModelName from '@/models/ModelName'
  const importPattern = /import\s+(\w+)\s+from\s+['"]@\/models\/\w+['"]/g;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    if (MODEL_IMPORTS.includes(match[1])) {
      models.add(match[1]);
    }
  }
  
  // Also check for destructured imports
  const destructuredPattern = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]@\/models\/\w+['"]/g;
  while ((match = destructuredPattern.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim());
    names.forEach(name => {
      if (MODEL_IMPORTS.includes(name)) {
        models.add(name);
      }
    });
  }
  
  return Array.from(models);
}

function migrateRoute(filePath) {
  const routePath = filePath.replace(API_DIR, '/api').replace('/route.js', '');
  stats.scanned++;
  
  // Check if should skip
  if (shouldSkip(routePath)) {
    if (VERBOSE) console.log(`⏭️  Skipping (public route): ${routePath}`);
    stats.skipped++;
    return;
  }
  
  // Filter by specific route if provided
  if (ROUTE_FILTER && !routePath.startsWith(ROUTE_FILTER)) {
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if already migrated
  if (content.includes('getAuthAndModels') || content.includes('getTenantModel')) {
    if (VERBOSE) console.log(`✅ Already migrated: ${routePath}`);
    stats.alreadyMigrated++;
    return;
  }
  
  // Check if uses connectDB
  if (!content.includes('connectDB')) {
    if (VERBOSE) console.log(`⚪ No DB access: ${routePath}`);
    stats.skipped++;
    return;
  }
  
  console.log(`🔄 Migrating: ${routePath}`);
  
  try {
    const modelsUsed = extractModelImports(content);
    
    if (modelsUsed.length === 0) {
      console.log(`   ⚠️  No model imports found, skipping`);
      stats.skipped++;
      return;
    }
    
    let newContent = content;
    
    // Step 1: Remove connectDB import
    newContent = newContent.replace(
      /import\s+connectDB\s+from\s+['"]@\/lib\/mongodb['"]\s*\n?/g,
      ''
    );
    
    // Step 2: Remove model imports (one by one to preserve other imports)
    modelsUsed.forEach(model => {
      // Remove single model imports
      newContent = newContent.replace(
        new RegExp(`import\\s+${model}\\s+from\\s+['"]@\\/models\\/${model}['"]\\s*\\n?`, 'g'),
        ''
      );
    });
    
    // Step 3: Add getAuthAndModels import if not present
    if (!newContent.includes("from '@/lib/auth'")) {
      // Find the first import statement and add after it
      const firstImportIndex = newContent.indexOf('import ');
      if (firstImportIndex >= 0) {
        const endOfFirstImport = newContent.indexOf('\n', firstImportIndex);
        const insertPosition = endOfFirstImport + 1;
        newContent = newContent.slice(0, insertPosition) +
          "import { getAuthAndModels } from '@/lib/auth'\n" +
          newContent.slice(insertPosition);
      }
    } else {
      // Update existing auth import to include getAuthAndModels
      if (!newContent.includes('getAuthAndModels')) {
        newContent = newContent.replace(
          /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]@\/lib\/auth['"]/,
          (match, imports) => {
            const importList = imports.split(',').map(i => i.trim());
            if (!importList.includes('getAuthAndModels')) {
              importList.push('getAuthAndModels');
            }
            return `import { ${importList.join(', ')} } from '@/lib/auth'`;
          }
        );
      }
    }
    
    // Step 4: Replace await connectDB() with getAuthAndModels call
    // This is tricky because we need to add the auth check and model destructuring
    const modelsList = modelsUsed.map(m => m).join(', ');
    const modelsArray = modelsUsed.map(m => `'${m}'`).join(', ');
    
    // Pattern: await connectDB() followed by some code
    // We need to replace it with getAuthAndModels and add auth check
    const connectDBPattern = /await\s+connectDB\(\)\s*\n?/g;
    
    // Check if there's already verifyTokenFromRequest being used
    const usesVerifyToken = content.includes('verifyTokenFromRequest');
    
    if (usesVerifyToken) {
      // If already using verifyTokenFromRequest, we need a more complex replacement
      // Just replace connectDB with a comment for manual review
      newContent = newContent.replace(
        connectDBPattern,
        `// TODO: MIGRATION - Replace verifyTokenFromRequest with getAuthAndModels\n    // const { success, user, models, message } = await getAuthAndModels(request, [${modelsArray}])\n    // if (!success) return NextResponse.json({ message }, { status: 401 })\n    // const { ${modelsList} } = models\n    `
      );
      console.log(`   ⚠️  Uses verifyTokenFromRequest - needs manual review`);
    } else {
      // Simple case - replace connectDB with getAuthAndModels
      // Find the first occurrence and replace with full pattern
      let firstReplace = true;
      newContent = newContent.replace(connectDBPattern, () => {
        if (firstReplace) {
          firstReplace = false;
          return `// Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, [${modelsArray}])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ${modelsList} } = models

    `;
        }
        return ''; // Remove subsequent connectDB calls
      });
    }
    
    // Step 5: Clean up empty lines
    newContent = newContent.replace(/\n{3,}/g, '\n\n');
    
    if (DRY_RUN) {
      console.log(`   📝 Would migrate with models: [${modelsList}]`);
      if (VERBOSE) {
        console.log('   Preview of changes:');
        console.log('   ---');
        // Show first 500 chars of new content
        console.log(newContent.substring(0, 500) + '...');
        console.log('   ---');
      }
    } else {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log(`   ✅ Migrated with models: [${modelsList}]`);
    }
    
    stats.migrated++;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    stats.errors++;
  }
}

function main() {
  console.log('\n🔄 Multi-Tenant Route Migration Script');
  console.log('═'.repeat(50));
  
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No files will be modified\n');
  }
  
  if (ROUTE_FILTER) {
    console.log(`📍 Filtering to routes starting with: ${ROUTE_FILTER}\n`);
  }
  
  const routeFiles = findRouteFiles(API_DIR);
  console.log(`Found ${routeFiles.length} route files\n`);
  
  for (const file of routeFiles) {
    migrateRoute(file);
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('📊 Migration Summary:');
  console.log(`   Scanned:          ${stats.scanned}`);
  console.log(`   Migrated:         ${stats.migrated}`);
  console.log(`   Already migrated: ${stats.alreadyMigrated}`);
  console.log(`   Skipped:          ${stats.skipped}`);
  console.log(`   Errors:           ${stats.errors}`);
  console.log('');
  
  if (DRY_RUN && stats.migrated > 0) {
    console.log('💡 Run without --dry-run to apply changes');
  }
}

main();
