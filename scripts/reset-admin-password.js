/**
 * Script to reset admin password
 * Run with: node scripts/reset-admin-password.js <email> <newPassword>
 * 
 * This will properly hash the password and save it to the database.
 */

const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables')
  process.exit(1)
}

// Get arguments
const email = process.argv[2]
const newPassword = process.argv[3]

if (!email || !newPassword) {
  console.log('Usage: node scripts/reset-admin-password.js <email> <newPassword>')
  console.log('Example: node scripts/reset-admin-password.js admin@example.com MyNewPassword123')
  process.exit(1)
}

async function resetPassword() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB')

    // Get the users collection directly (bypass model to avoid issues)
    const db = mongoose.connection.db
    const usersCollection = db.collection('users')

    // Find the user
    const user = await usersCollection.findOne({ email: email.toLowerCase() })

    if (!user) {
      console.error(`❌ User with email "${email}" not found`)
      process.exit(1)
    }

    console.log(`\n📋 Found user:`)
    console.log(`   ID: ${user._id}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   Role: ${user.role}`)
    console.log(`   isActive: ${user.isActive}`)
    console.log(`   Current password hash: ${user.password ? user.password.substring(0, 20) + '...' : 'NOT SET'}`)

    // Check if current password looks like a bcrypt hash
    const isBcryptHash = user.password && user.password.startsWith('$2')
    console.log(`   Password is bcrypt hash: ${isBcryptHash ? 'Yes' : 'No (plain text or invalid)'}`)

    // Hash the new password
    console.log(`\n🔐 Hashing new password...`)
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(newPassword, salt)

    // Update the user
    const result = await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedPassword,
          forcePasswordChange: false, // Allow login without forcing change
          isActive: true,
          updatedAt: new Date()
        }
      }
    )

    if (result.modifiedCount === 1) {
      console.log(`\n✅ Password reset successfully!`)
      console.log(`\n📋 Login credentials:`)
      console.log(`   Email: ${user.email}`)
      console.log(`   Password: ${newPassword}`)
      console.log(`   forcePasswordChange: false`)
      
      // Verify the password works
      console.log(`\n🔍 Verifying password...`)
      const updatedUser = await usersCollection.findOne({ _id: user._id })
      const isValid = await bcrypt.compare(newPassword, updatedUser.password)
      console.log(`   Password verification: ${isValid ? '✅ PASSED' : '❌ FAILED'}`)
    } else {
      console.error('❌ Failed to update password')
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await mongoose.disconnect()
    console.log('\n🔌 Disconnected from MongoDB')
  }
}

resetPassword()
