// Pinned, fail-closed portal compatibility patch; no change to the renderer,
// geometry, colours or expressions. Reapplied after clean npm installs.
const fs = require('node:fs')
const path = require('node:path')
const manifest = require.resolve('robot-heads/package.json')
if (JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== '0.3.0') throw new Error('Review the robot-heads window patch before upgrading.')
const target = path.join(path.dirname(manifest), 'dist/index.js')
let source = fs.readFileSync(target, 'utf8')
const marker = '// Talio owner-document animation compatibility'
if (!source.includes(marker)) {
  const replace = (from, to) => {
    if (!source.includes(from)) throw new Error('robot-heads patch source changed: ' + from.slice(0, 60))
    source = source.replace(from, to)
  }
  replace('function Wn(n) {\n  return Vn(), pt.add(n), wn(), () => {\n    pt.delete(n), pt.size || kn();\n  };\n}', 'function Wn(n, ownerDocument) { return subscribeRobotFrame(n, ownerDocument); }')
  replace('const g = C.current, X = I.current;', 'const ht = robotPointer(u.current?.ownerDocument);\n      const g = C.current, X = I.current;')
  replace('g.update(y * V.current), _(!0);\n    });', 'g.update(y * V.current), _(!0);\n    }, () => u.current?.ownerDocument);')
  source = marker + '\nimport { subscribeRobotFrame, robotPointer } from "../../../lib/miraRobotWindowLoop.js";\n' + source
  fs.writeFileSync(target, source)
}
