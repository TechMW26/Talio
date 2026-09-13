// Database names come from trusted tenant mappings, never request query params.
// Validate before interpolation into a URI or looking up a cached handle.
export function assertDatabaseName(name, { tenant = false } = {}) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(name)) {
    throw new TypeError('Invalid database name');
  }
  if (tenant && ['admin', 'config', 'local', 'talio_superadmin'].includes(name.toLowerCase())) {
    throw new TypeError('System databases cannot be used as tenant databases');
  }
  return name;
}
