'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// One isolated worker per task. No API credentials or authentication tokens are
// passed to it; model requests are relayed through the authenticated renderer.
function createAgentS({ packaged, resourcesPath, platform = process.platform, arch = process.arch }) {
  const executable = path.join(packaged ? resourcesPath : path.join(__dirname, '..', 'build', `agent-s-${platform}-${arch}`), ...(packaged ? ['agent-s'] : []), platform === 'win32' ? 'mira-agent-s.exe' : 'mira-agent-s');
  let child = null; let pending = null; let buffer = ''; let timer;
  function stop() {
    clearTimeout(timer);
    const waiter = pending; pending = null;
    const running = child; child = null; buffer = '';
    running?.kill();
    waiter?.reject(new Error('The local desktop planner stopped.'));
  }
  function exchange(command) {
    if (!child || pending) return Promise.reject(new Error('The desktop planner is unavailable or busy.'));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      timer = setTimeout(stop, 70000);
      child.stdin.write(JSON.stringify(command) + '\n', error => { if (error) stop(); });
    });
  }
  return {
    available: () => fs.existsSync(executable),
    stop,
    async begin(goal) {
      if (!fs.existsSync(executable)) throw new Error('This desktop build is missing the local Agent S runtime. Please update Talio.');
      stop();
      child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR, DISPLAY: process.env.DISPLAY, XAUTHORITY: process.env.XAUTHORITY, PYTHONNOUSERSITE: '1' } });
      const worker = child;
      const workerStopped = () => { if (child === worker) stop(); };
      child.once('error', workerStopped); child.once('exit', workerStopped);
      child.stdout.on('data', data => {
        if (child !== worker) return;
        buffer += data.toString('utf8');
        if (buffer.length > 12 * 1024 * 1024) return stop();
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!pending || buffer.trim()) return stop();
        try {
          const message = JSON.parse(line);
          if (!['ready', 'model_request', 'result', 'error'].includes(message.kind)) return stop();
          clearTimeout(timer); const waiter = pending; pending = null;
          if (message.kind === 'error') waiter.reject(new Error(message.message));
          else waiter.resolve(message);
        } catch { stop(); }
      });
      return exchange({ operation: 'begin', goal });
    },
    predict: observation => exchange({ operation: 'predict', ...observation }),
    respond: text => exchange({ operation: 'model_response', text }),
  };
}
module.exports = { createAgentS };
