/**
 * Backup Database Connection
 * 
 * Maintains a separate MongoDB connection for user data backup.
 * This is completely independent of the main database and uses
 * fire-and-forget pattern to not affect main application workflows.
 */

import mongoose from 'mongoose'

const MONGODB_BACKUP_URI = process.env.MONGODB_BACKUP_URI

// Separate connection instance for backup database
let backupConnection = null
let connectionPromise = null

/**
 * Get or create backup database connection
 * Returns null if backup URI is not configured (graceful degradation)
 */
async function getBackupConnection() {
  // Skip if backup URI not configured
  if (!MONGODB_BACKUP_URI) {
    return null
  }

  // Return existing connection if healthy
  if (backupConnection && backupConnection.readyState === 1) {
    return backupConnection
  }

  // Prevent concurrent connection attempts
  if (connectionPromise) {
    return connectionPromise
  }

  connectionPromise = (async () => {
    try {
      // Create new connection (separate from main mongoose connection)
      backupConnection = await mongoose.createConnection(MONGODB_BACKUP_URI, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000,
      }).asPromise()

      console.log('✅ Backup database connected')
      
      // Handle connection errors
      backupConnection.on('error', (err) => {
        console.error('Backup database error:', err.message)
      })

      backupConnection.on('disconnected', () => {
        console.log('⚠️ Backup database disconnected')
        backupConnection = null
      })

      return backupConnection
    } catch (error) {
      console.error('Failed to connect to backup database:', error.message)
      backupConnection = null
      return null
    } finally {
      connectionPromise = null
    }
  })()

  return connectionPromise
}

/**
 * Backup User Schema
 * Stores minimal user data for backup purposes
 */
const BackupUserSchema = new mongoose.Schema({
  // Reference to original user ID in main database
  originalUserId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
    index: true,
  },
  // User credentials and info
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  firstName: {
    type: String,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['admin', 'hr', 'manager', 'employee', 'department_head'],
    default: 'employee',
  },
  // Metadata
  createdInMainDb: {
    type: Date,
    default: Date.now,
  },
  lastSyncedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  collection: 'User', // Collection name in TalioUsers database
})

// Model cache to prevent re-compilation
let BackupUserModel = null

/**
 * Get BackupUser model
 */
async function getBackupUserModel() {
  const conn = await getBackupConnection()
  if (!conn) return null

  if (!BackupUserModel) {
    // Check if model already exists on this connection
    BackupUserModel = conn.models.User || conn.model('User', BackupUserSchema)
  }
  
  return BackupUserModel
}

/**
 * Sync user to backup database (fire-and-forget)
 * 
 * @param {Object} userData - User data to backup
 * @param {string} userData.userId - Original user ID from main DB
 * @param {string} userData.email - User email
 * @param {string} userData.firstName - First name
 * @param {string} userData.lastName - Last name  
 * @param {string} userData.password - Hashed password
 * @param {string} userData.role - User role
 */
export async function syncUserToBackup(userData) {
  try {
    const BackupUser = await getBackupUserModel()
    if (!BackupUser) {
      // Backup DB not configured, silently skip
      return
    }

    await BackupUser.findOneAndUpdate(
      { originalUserId: userData.userId },
      {
        originalUserId: userData.userId,
        email: userData.email,
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        password: userData.password,
        role: userData.role || 'employee',
        lastSyncedAt: new Date(),
      },
      { upsert: true, new: true }
    )

    console.log(`✅ User ${userData.email} synced to backup DB`)
  } catch (error) {
    // Fire-and-forget: log error but don't throw
    console.error(`⚠️ Failed to sync user ${userData.email} to backup:`, error.message)
  }
}

/**
 * Delete user from backup database (fire-and-forget)
 * 
 * @param {string} userId - Original user ID from main DB
 */
export async function deleteUserFromBackup(userId) {
  try {
    const BackupUser = await getBackupUserModel()
    if (!BackupUser) {
      return
    }

    const result = await BackupUser.findOneAndDelete({ originalUserId: userId })
    if (result) {
      console.log(`✅ User ${result.email} deleted from backup DB`)
    }
  } catch (error) {
    console.error(`⚠️ Failed to delete user ${userId} from backup:`, error.message)
  }
}

/**
 * Bulk sync users to backup database
 * Used for initial migration of existing users
 * 
 * @param {Array} users - Array of user objects with populated employee data
 */
export async function bulkSyncUsersToBackup(users) {
  try {
    const BackupUser = await getBackupUserModel()
    if (!BackupUser) {
      console.log('⚠️ Backup database not configured, skipping bulk sync')
      return { success: false, message: 'Backup DB not configured' }
    }

    const operations = users.map(user => ({
      updateOne: {
        filter: { originalUserId: user._id },
        update: {
          $set: {
            originalUserId: user._id,
            email: user.email,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            password: user.password,
            role: user.role || 'employee',
            lastSyncedAt: new Date(),
          }
        },
        upsert: true,
      }
    }))

    const result = await BackupUser.bulkWrite(operations)
    console.log(`✅ Bulk synced ${result.upsertedCount + result.modifiedCount} users to backup DB`)
    
    return {
      success: true,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    }
  } catch (error) {
    console.error('⚠️ Bulk sync to backup failed:', error.message)
    return { success: false, message: error.message }
  }
}

export { getBackupConnection, getBackupUserModel }
