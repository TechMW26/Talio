'use strict';
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

// Data files only. No arbitrary paths, execution, overwrites or symlink traversal.
async function createMiraFile(name, content, root = path.join(os.homedir(), 'Documents', 'MIRA')) {
  if (typeof name !== 'string' || !/^[\p{L}\p{N} _.-]{1,100}\.(txt|md|csv|json)$/u.test(name) || name.startsWith('.') || name.includes('..')) throw new Error('Use a simple .txt, .md, .csv or .json filename.');
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 20000) throw new Error('File content is too large.');
  if (name.endsWith('.json')) JSON.parse(content);
  await fs.mkdir(root, { recursive: true });
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('The MIRA folder must not be a symbolic link.');
  const destination = path.join(root, name);
  await fs.writeFile(destination, content, { flag: 'wx', mode: 0o600 });
  return destination;
}
module.exports = { createMiraFile };
