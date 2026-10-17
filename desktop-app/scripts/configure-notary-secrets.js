'use strict';

// Called by setup-notary-profile.sh only after Apple validates the credentials.
// Values travel over child stdin/env, never logs, command arguments or files.
const { execFileSync, spawnSync } = require('node:child_process');
const { TEAM_ID } = require('../src/macSigningPolicy');

function main() {
  const appleId = process.env.TALIO_NOTARY_APPLE_ID;
  const password = process.env.TALIO_NOTARY_PASSWORD;
  if (!appleId || !password) throw new Error('Run npm run setup:notary-profile -- --github from desktop-app.');
  const entries = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 15000,
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim().split('\n');
  const token = entries.find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('Sign in to GitHub with a Talio repository administrator account first.');
  const env = { ...process.env, GH_TOKEN: token };
  delete env.TALIO_NOTARY_APPLE_ID;
  delete env.TALIO_NOTARY_PASSWORD;
  for (const [name, value] of Object.entries({ APPLE_ID: appleId, APPLE_ID_PASSWORD: password, APPLE_TEAM_ID: TEAM_ID })) {
    const result = spawnSync('gh', ['secret', 'set', name, '--repo', 'TechMW26/Talio'], {
      input: value, env, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status !== 0) throw new Error(`Could not configure ${name}. Check repository administrator access and retry setup.`);
    console.log(`Configured ${name} for TechMW26/Talio.`);
  }
}
try { main(); } catch (error) {
  // Do not print subprocess errors: they can include credential-bearing input.
  console.error(error instanceof Error && !('cmd' in error) ? error.message : 'Notarization secret setup failed. Check GitHub access and retry.');
  process.exitCode = 1;
}
