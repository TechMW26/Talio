// Resolve once per request, not once per cache state. Cycles are legitimate
// (for example User -> Team -> Employee), so visit every model at most once.
export function resolveModelDependencies(names, schemas, aliases = {}, dependencies = {}) {
  if (!Array.isArray(names)) throw new TypeError('Model names must be an array');
  const resolved = new Set();
  const requestedAliases = new Map();
  const resolveName = (name) => {
    const canonical = Object.hasOwn(aliases, name) ? aliases[name] : name;
    if (typeof name !== 'string' || !Object.hasOwn(schemas, canonical)) {
      throw new Error(`Unknown model: ${String(name)}`);
    }
    if (canonical !== name) requestedAliases.set(name, canonical);
    return canonical;
  };
  function visit(name) {
    const canonical = resolveName(name);
    if (resolved.has(canonical)) return;
    resolved.add(canonical);
    for (const dependency of dependencies[canonical] || []) visit(dependency);
  }
  names.forEach(visit);
  return { names: [...resolved], aliases: requestedAliases };
}
