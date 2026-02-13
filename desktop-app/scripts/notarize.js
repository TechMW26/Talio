/**
 * Notarize script for macOS apps
 * 
 * This script runs after signing to notarize the app with Apple.
 * Notarization is required for apps to run without Gatekeeper warnings on macOS.
 * 
 * Required environment variables:
 * - APPLE_ID: Your Apple Developer account email
 * - APPLE_ID_PASSWORD: App-specific password (not your Apple ID password)
 * - APPLE_TEAM_ID: Your Apple Developer Team ID
 * 
 * To create an app-specific password:
 * 1. Go to https://appleid.apple.com/account/manage
 * 2. Sign in with your Apple ID
 * 3. Under "Security", click "Generate Password"
 * 4. Use this password for APPLE_ID_PASSWORD
 * 
 * To find your Team ID:
 * 1. Go to https://developer.apple.com/account
 * 2. Your Team ID is shown in the top right or under Membership
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization: not macOS');
    return;
  }

  // Check if notarization credentials are available
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization: missing credentials');
    console.log('  APPLE_ID:', appleId ? 'set' : 'not set');
    console.log('  APPLE_ID_PASSWORD:', appleIdPassword ? 'set' : 'not set');
    console.log('  APPLE_TEAM_ID:', teamId ? 'set' : 'not set');
    console.log('');
    console.log('To enable notarization, set these environment variables:');
    console.log('  export APPLE_ID="your-apple-id@email.com"');
    console.log('  export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"');
    console.log('  export APPLE_TEAM_ID="XXXXXXXXXX"');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);
  console.log('This may take several minutes...');

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error.message);
    // Don't fail the build if notarization fails
    // This allows building without credentials for testing
    if (process.env.REQUIRE_NOTARIZATION === 'true') {
      throw error;
    }
  }
};
