'use strict';
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

// One isolated, serialized native helper per task. No HTTP port or credentials.
// Never replay an input after a timeout, crash, or malformed reply.
function createControlTransport(command, args = [], spawnProcess = spawn) {
  let child, pending, buffer = '';
  let decoder = new StringDecoder('utf8');
  const stop = () => {
    const old = child; child = null; buffer = ''; decoder = new StringDecoder('utf8');
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Native input interrupted; outcome uncertain.')); pending = null; }
    old?.kill();
  };
  function start() {
    const process = spawnProcess(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child = process;
    process.stderr.on('data', () => {}); // Never log UI contents.
    process.on('error', () => { if (child === process) stop(); });
    process.stdin.on('error', () => { if (child === process) stop(); });
    process.on('exit', () => { if (child === process) stop(); });
    process.stdout.on('data', chunk => {
      if (child !== process) return;
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      if (buffer.length > (pending?.maxReplyBytes || 100000)) { stop(); return; }
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!pending || buffer.trim()) { stop(); return; }
      try {
        const value = JSON.parse(line);
        if (typeof value.success !== 'boolean') throw new Error('Invalid native reply');
        const done = pending; pending = null; clearTimeout(done.timer); done.resolve(value);
      } catch { stop(); }
    });
  }
  return {
    async request(action) {
      if (pending) throw new Error('A native input is already running.');
      if (!child) start();
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, maxReplyBytes: action.type === 'capture' ? 2000000 : 100000, timer: setTimeout(stop, 12000) };
        const activeChild = child;
        activeChild.stdin.write(JSON.stringify(action) + '\n', error => { if (error && child === activeChild) stop(); });
      });
    },
    stop,
  };
}
module.exports = { createControlTransport };
