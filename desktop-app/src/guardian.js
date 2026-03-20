/**
 * Talio Desktop Guardian Process v5.1.0
 * 
 * Lightweight background watchdog that monitors the main Electron process.
 * If the Electron app exits (force-quit, crash, kill -9, Task Manager), 
 * this guardian restarts it automatically.
 *
 * Launched by main.js on startup as a detached child process.
 * Communicates via a heartbeat: main process writes a timestamp to a file
 * every 10 seconds. If the timestamp goes stale (>30s), guardian restarts.
 * Also monitors the process directly via kill(pid, 0).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CHECK_INTERVAL_MS = 10000;      // Check every 10 seconds
const HEARTBEAT_STALE_MS = 35000;     // Consider stale after 35 seconds
const RESTART_DELAY_MS = 3000;        // Wait 3 seconds before restarting
const MAX_RAPID_RESTARTS = 5;         // Max restarts within RAPID_WINDOW
const RAPID_WINDOW_MS = 120000;       // 2 minute window for rapid restart detection

// Get paths
const heartbeatPath = process.argv[2];
const electronPath = process.argv[3];
const appPath = process.argv[4];
const mainPid = parseInt(process.argv[5], 10);

if (!heartbeatPath || !electronPath || !appPath || !mainPid) {
  process.exit(1);
}

// Track restarts to prevent crash loops
const restartTimes = [];

function log(msg) {
  const ts = new Date().toISOString();
  try {
    const logPath = path.join(path.dirname(heartbeatPath), 'guardian.log');
    fs.appendFileSync(logPath, ts + ' ' + msg + '\n');
  } catch (e) {
    // Ignore write errors
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function isHeartbeatFresh() {
  try {
    const data = fs.readFileSync(heartbeatPath, 'utf8').trim();
    const timestamp = parseInt(data, 10);
    if (isNaN(timestamp)) return false;
    return (Date.now() - timestamp) < HEARTBEAT_STALE_MS;
  } catch (e) {
    return false;
  }
}

function shouldRestart() {
  const now = Date.now();
  // Clean old entries
  while (restartTimes.length > 0 && now - restartTimes[0] > RAPID_WINDOW_MS) {
    restartTimes.shift();
  }
  if (restartTimes.length >= MAX_RAPID_RESTARTS) {
    log('Too many rapid restarts (' + restartTimes.length + ' in ' + (RAPID_WINDOW_MS / 1000) + 's) — backing off');
    return false;
  }
  return true;
}

function restartApp() {
  if (!shouldRestart()) return;

  restartTimes.push(Date.now());
  log('Restarting Talio (attempt ' + restartTimes.length + ')');

  try {
    const child = spawn(electronPath, [appPath], {
      detached: true,
      stdio: 'ignore',
      env: Object.assign({}, process.env, { TALIO_GUARDIAN_RESTART: '1' })
    });
    child.unref();
    log('Talio restarted with PID ' + child.pid);
  } catch (e) {
    log('Failed to restart: ' + e.message);
  }
}

// Track the PID we're watching (starts as the launching process)
let watchPid = mainPid;

log('Guardian started — watching PID ' + watchPid + ', heartbeat: ' + heartbeatPath);

// Main monitoring loop
setInterval(function () {
  const processAlive = isProcessRunning(watchPid);
  const heartbeatOk = isHeartbeatFresh();

  if (!processAlive && !heartbeatOk) {
    log('Talio process (PID ' + watchPid + ') is dead and heartbeat is stale — restarting');
    setTimeout(function () {
      restartApp();
      // After restart, try to pick up the new PID from heartbeat file
      // The new process will write its PID to a pid file
      setTimeout(function () {
        try {
          const pidFilePath = heartbeatPath.replace('heartbeat', 'pid');
          const newPid = parseInt(fs.readFileSync(pidFilePath, 'utf8').trim(), 10);
          if (!isNaN(newPid) && newPid > 0) {
            watchPid = newPid;
            log('Now watching new PID ' + watchPid);
          }
        } catch (e) {
          // Will pick up on next cycle
        }
      }, 5000);
    }, RESTART_DELAY_MS);
  }
}, CHECK_INTERVAL_MS);

// Clean exit if the guardian itself receives SIGTERM
process.on('SIGTERM', function () {
  log('Guardian received SIGTERM — exiting');
  process.exit(0);
});

// Keep running
process.on('uncaughtException', function (e) {
  log('Uncaught exception: ' + e.message);
});
