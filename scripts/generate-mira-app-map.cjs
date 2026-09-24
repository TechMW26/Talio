// Build the application atlas from actual App Router pages and their local UI imports.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const pages = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/^page\.[jt]sx?$/.test(entry.name)) pages.push(file)
  }
}
walk(path.join(root, 'app'))
const cache = new Map()
function inspect(file) {
  if (cache.has(file)) return cache.get(file)
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  const result = { labels: new Set(), imports: [] }
  cache.set(file, result)
  const add = value => { const text = value.replace(/\s+/g, ' ').trim(); if (text && text.length <= 90) result.labels.add(text) }
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(source)
      if (/^(button|Button|h[1-6]|label|Tab|ModalHeader|DialogTitle)$/i.test(tag)) {
        const text = node.children.filter(ts.isJsxText).map(n => n.text).join(' ')
        add(text)
      }
    }
    if (ts.isJsxAttribute(node) && /^(aria-label|title|placeholder)$/.test(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text)
    if (ts.isPropertyAssignment(node) && /^(label|title|placeholder|name)$/.test(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) add(node.initializer.text)
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text
      const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null
      if (base && /\/(components|app)\//.test(base)) {
        const target = [base, ...['.js', '.jsx', '.tsx', '/index.js'].map(ext => base + ext)].find(f => fs.existsSync(f) && fs.statSync(f).isFile())
        if (target) result.imports.push(target)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}
const menuSource = fs.readFileSync(path.join(root, 'utils/roleBasedMenus.js'), 'utf8')
const names = new Map()
for (const match of menuSource.matchAll(/name:\s*['"]([^'"]+)['"][^{}]*?path:\s*['"]([^'"]+)['"]/g)) {
  if (!names.has(match[2])) names.set(match[2], match[1])
}
const atlas = pages.sort().map(file => {
  const route = '/' + path.relative(path.join(root, 'app'), path.dirname(file)).split(path.sep).join('/')
  const labels = new Set(), visited = new Set()
  function collect(file, depth = 0) {
    if (visited.has(file)) return
    visited.add(file)
    const ui = inspect(file)
    ui.labels.forEach(label => labels.add(label))
    ui.imports.forEach(child => collect(child, depth + 1))
  }
  collect(file)
  return { route, name: names.get(route) || route.replace(/^\/dashboard\/?/, '').replace(/\//g, ' / ').replace(/-/g, ' ') || 'Dashboard', controls: [...labels].sort(), sources: [...visited].map(file => path.relative(root, file)).sort() }
})
const output = JSON.stringify(atlas, null, 2) + '\n'
const destination = path.join(root, 'lib/miraAppMap.generated.json')
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) { console.error('MIRA application map is stale. Run npm run mira:map.'); process.exit(1) }
} else fs.writeFileSync(destination, output)
const routeFile = path.join(root, 'lib/miraAppRoutes.generated.json')
const routeOutput = JSON.stringify(atlas.map(page => page.route), null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(routeFile) || fs.readFileSync(routeFile, 'utf8') !== routeOutput) { console.error('MIRA routes are stale. Run npm run mira:map.'); process.exit(1) }
} else fs.writeFileSync(routeFile, routeOutput)
console.log(`MIRA application map: ${atlas.length} routes, ${atlas.reduce((sum, page) => sum + page.controls.length, 0)} source UI labels`)
