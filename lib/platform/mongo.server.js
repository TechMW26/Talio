import { MongoClient } from 'mongodb'

// One bounded connection pool per server process, shared by all tenant scopes.
// Credentials are never logged and a changed URI starts a separate pool.
const clients = new Map()

export async function getTalioMongoClient(env = process.env) {
  if (typeof window !== 'undefined') throw new Error('MongoDB data access is server-only')
  const uri = env.MONGODB_URI
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MONGODB_URI is required for MongoDB data access')
  if (!clients.has(uri)) {
    const client = new MongoClient(uri, {
      appName: 'talio', maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000,
      retryWrites: true, promoteBuffers: true,
    })
    const pending = client.connect().then(() => client).catch(async error => {
      clients.delete(uri)
      await client.close().catch(() => {})
      throw error
    })
    clients.set(uri, pending)
  }
  return clients.get(uri)
}

export async function getTalioMongoDatabase(env = process.env) {
  const name = env.MONGODB_DATABASE
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(name)) throw new Error('Invalid MONGODB_DATABASE')
  return (await getTalioMongoClient(env)).db(name)
}
