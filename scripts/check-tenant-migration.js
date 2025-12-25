/**
 * Multi-Tenant Migration Helper
 * 
 * This script identifies all API routes that need to be updated for multi-tenant support.
 * It searches for usage of connectDB() and categorizes routes by their migration status.
 * 
 * Usage: node scripts/check-tenant-migration.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_DIR = path.join(__dirname, '..', 'app', 'api');

// Routes that are allowed to use connectDB() without tenant context
// These are public/system routes that don't require user authentication
const ALLOWED_PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/register', 
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/google/callback',
  '/api/setup/check',
  '/api/setup/create-admin',
  '/api/setup/tenant',
  '/api/cron/', // Cron routes use CRON_SECRET
  '/api/superadmin/', // SuperAdmin routes use separate auth
  '/api/assetlinks',
  '/api/test-',
];

// Check if a route is allowed to be public
function isAllowedPublic(filePath) {
  const relativePath = filePath.replace(API_DIR, '/api').replace('/route.js', '');
  return ALLOWED_PUBLIC_ROUTES.some(route => relativePath.startsWith(route));
}

// Find all route files
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

// Analyze a route file
function analyzeRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = filePath.replace(API_DIR, '/api').replace('/route.js', '');
  
  const analysis = {
    path: relativePath,
    filePath,
    usesConnectDB: content.includes('await connectDB()'),
    usesGetAuthAndModels: content.includes('getAuthAndModels'),
    usesVerifyTokenFromRequest: content.includes('verifyTokenFromRequest'),
    usesTenantModels: content.includes('getTenantModel') || content.includes('getTenantModels'),
    isPublicAllowed: isAllowedPublic(filePath),
    needsMigration: false,
    status: 'unknown'
  };
  
  // Determine migration status
  if (analysis.isPublicAllowed) {
    analysis.status = 'public-allowed';
    analysis.needsMigration = false;
  } else if (analysis.usesGetAuthAndModels || analysis.usesTenantModels) {
    analysis.status = 'migrated';
    analysis.needsMigration = false;
  } else if (analysis.usesConnectDB) {
    analysis.status = 'needs-migration';
    analysis.needsMigration = true;
  } else {
    analysis.status = 'no-db-access';
    analysis.needsMigration = false;
  }
  
  return analysis;
}

// Main
function main() {
  console.log('\n🔍 Analyzing API routes for multi-tenant migration...\n');
  
  const routeFiles = findRouteFiles(API_DIR);
  const analyses = routeFiles.map(analyzeRoute);
  
  // Group by status
  const grouped = {
    'needs-migration': [],
    'migrated': [],
    'public-allowed': [],
    'no-db-access': []
  };
  
  for (const analysis of analyses) {
    grouped[analysis.status].push(analysis);
  }
  
  // Print summary
  console.log('📊 Migration Status Summary:');
  console.log('─'.repeat(60));
  console.log(`  ✅ Already migrated:     ${grouped['migrated'].length}`);
  console.log(`  🔓 Public (allowed):     ${grouped['public-allowed'].length}`);
  console.log(`  ⚪ No DB access:         ${grouped['no-db-access'].length}`);
  console.log(`  ❌ NEEDS MIGRATION:      ${grouped['needs-migration'].length}`);
  console.log('─'.repeat(60));
  
  if (grouped['needs-migration'].length > 0) {
    console.log('\n⚠️  Routes that need migration to multi-tenant:\n');
    
    for (const route of grouped['needs-migration']) {
      console.log(`  ${route.path}`);
    }
    
    console.log('\n📝 To migrate a route:');
    console.log('   1. Import: import { getAuthAndModels } from "@/lib/auth"');
    console.log('   2. Replace: await connectDB()');
    console.log('   3. With: const { success, user, models, message } = await getAuthAndModels(request, ["ModelName"])');
    console.log('   4. Check: if (!success) return NextResponse.json({ message }, { status: 401 })');
    console.log('   5. Use: models.ModelName instead of ModelName');
  } else {
    console.log('\n✅ All routes are properly migrated for multi-tenant support!');
  }
  
  console.log('\n');
}

main();
