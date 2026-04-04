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

function getNotarizeOptions(appPath) {
  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
  if (keychainProfile) {
    return {
      appPath,
      keychainProfile,
    };
  }

  const apiKey = process.env.APPLE_API_KEY;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;

  if (apiKey && apiKeyId && apiIssuer) {
    return {
      appPath,
      appleApiKey: apiKey,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer,
    };
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (appleId && appleIdPassword && teamId) {
    return {
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    };
  }

  return null;
}

function logMissingCredentialHelp() {
  console.log('Skipping notarization: missing credentials');
  console.log('');
  console.log('Supported notarization credential options:');
  console.log('  1. APPLE_KEYCHAIN_PROFILE=<stored-notarytool-profile>');
  console.log('  2. APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER');
  console.log('  3. APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID');
  console.log('');
  console.log('To create a reusable keychain profile:');
  console.log('  xcrun notarytool store-credentials "talio-notary" --apple-id "your-apple-id@email.com" --team-id "XXXXXXXXXX" --password "xxxx-xxxx-xxxx-xxxx"');
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  
  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization: not macOS');
    return;
  }

  const notarizeOptions = getNotarizeOptions(appPath);
  if (!notarizeOptions) {
    logMissingCredentialHelp();
    return;
  }

  console.log(`Notarizing ${appPath}...`);
  console.log('This may take several minutes...');

  try {
    await notarize(notarizeOptions);
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
