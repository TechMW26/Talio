// Compatibility with the trusted cross-scope workflow field-path contract,
// without importing a Firebase/Firestore data-plane SDK into runtime bundles.
export class MongoFieldPath {
  constructor(...segments) {
    if (!segments.length || segments.some(segment => typeof segment !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment) || /^__.*__$/.test(segment))) throw new TypeError('Invalid MongoDB workflow field path')
    this.segments = Object.freeze([...segments])
    Object.freeze(this)
  }
  toString() { return this.segments.join('.') }
}
