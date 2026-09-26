'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const target = `${process.platform}-${process.arch}`;
const venv = path.join(root, 'build', `agent-s-venv-${target}`);
const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const source = path.join(root, 'agent-s');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', cwd: root });
if (!fs.existsSync(python)) run(process.env.AGENT_S_BUILD_PYTHON || 'python3', ['-m', 'venv', venv]);
run(python, ['-c', 'import sys; assert sys.version_info[:2] == (3,12), "Agent S builds require Python 3.12"']);
run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(source, 'runtime-requirements.txt')]);
// Upstream declares <=3.12 (accidentally excluding 3.12 patch releases).
// We explicitly require and test the 3.12 minor above before ignoring that field.
run(python, ['-m', 'pip', 'install', '--no-deps', '--ignore-requires-python', '-r', path.join(source, 'requirements.txt')]);
run(python, ['-m', 'unittest', 'discover', '-s', source, '-p', 'test_*.py']);
run(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'mira-agent-s', '--paths', source,
  '--collect-all', 'gui_agents.s3', '--hidden-import', 'control', '--hidden-import', 'pyautogui', '--hidden-import', 'pyperclip', '--hidden-import', 'psutil',
  '--distpath', path.join(root, 'build', `agent-s-dist-${target}`), '--workpath', path.join(root, 'build', `agent-s-work-${target}`),
  '--specpath', path.join(root, 'build'), path.join(source, 'worker.py')]);
const bundled = path.join(root, 'build', `agent-s-${target}`);
// Preserve PyInstaller's relative library links. Node's default copy rewrites
// them to absolute build-machine paths, breaking repeat builds and installers.
const staging = path.join(root, 'build', `agent-s-staging-${target}-${Date.now()}`);
fs.cpSync(path.join(root, 'build', `agent-s-dist-${target}`, 'mira-agent-s'), staging, { recursive: true, verbatimSymlinks: true });
if (fs.existsSync(bundled)) fs.renameSync(bundled, `${bundled}-previous-${Date.now()}`);
fs.renameSync(staging, bundled);
// License is supplied by the pinned upstream package (Apache-2.0).
run(python, ['-c', 'import importlib.metadata as m, pathlib, shutil, sys; d=m.distribution("gui-agents"); files=[f for f in (d.files or []) if f.name.lower() in ("license", "license.txt", "license.md")]; assert files, "Upstream license missing"; shutil.copyfile(d.locate_file(files[0]), pathlib.Path(sys.argv[1])/"AGENT-S-LICENSE")', bundled]);
const sourceHash = require('crypto').createHash('sha256');
for (const file of ['actions.py', 'control.py', 'worker.py']) sourceHash.update(fs.readFileSync(path.join(source, file)));
fs.writeFileSync(path.join(bundled, 'runtime.json'), JSON.stringify({ platform: process.platform, arch: process.arch, revision: '3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693', sourceHash: sourceHash.digest('hex') }));
run(process.execPath, [path.join(root, 'scripts/test-agent-s.cjs')]);
console.log(`Agent S runtime prepared for ${target}`);
