'use strict';

const path = require('path');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);

// Keep these identities unchanged across versions and CPU architectures. macOS
// stores a code requirement, not just the visible app name, with TCC consent.
const TEAM_ID = '37R3XLT7BG';
const APP_ID = 'in.talio.desktop';
const HELPER_IDS = {
  'Contents/Resources/mira-control': `${APP_ID}.mira-control`,
  'Contents/Resources/agent-s/mira-agent-s': `${APP_ID}.mira-agent-s`,
};

function designatedRequirement(identifier) {
  return `anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${TEAM_ID}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`;
}

async function verifyMacApp(appPath, { run = execFile } = {}) {
  for (const [relativePath, identifier] of [['', APP_ID], ...Object.entries(HELPER_IDS)]) {
    const target = relativePath ? path.join(appPath, relativePath) : appPath;
    await run('/usr/bin/codesign', ['--verify', '--strict', ...(relativePath ? [] : ['--deep']), '-R', '=' + designatedRequirement(identifier), target], { timeout: 120000 });
    const result = await run('/usr/bin/codesign', ['--display', '--verbose=2', '--requirements', '-', target], { timeout: 15000 });
    const details = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (/Signature=adhoc|designated\s*=>[^\n]*\bcdhash\b/.test(details) ||
        !details.split('\n').includes(`TeamIdentifier=${TEAM_ID}`) ||
        !details.split('\n').includes(`Identifier=${identifier}`)) {
      throw new Error(`Unstable macOS signing identity for ${relativePath || 'Talio.app'}. Rebuild with Talio's Developer ID certificate; do not ship an ad-hoc build.`);
    }
  }
  return { appId: APP_ID, teamId: TEAM_ID };
}

module.exports = { APP_ID, TEAM_ID, HELPER_IDS, designatedRequirement, verifyMacApp };
