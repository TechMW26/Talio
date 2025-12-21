/**
 * Script to list all users in the database
 * Run with: node scripts/list-users.js
 */

const mongoose = require('mongoose')
require('dotenv').config()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables')
  process.exit(1)
}

async function listUsers() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    const db = mongoose.connection.db
    const usersCollection = db.collection('users')

    const users = await usersCollection.find({}).toArray()

    console.log(`📋 Found ${users.length} user(s):\n`)

    users.forEach((user, index) => {
      const isBcryptHash = user.password && user.password.startsWith('$2')
      console.log(`${index + 1}. ${user.email}`)
      console.log(`   ID: ${user._id}`)
      console.log(`   Role: ${user.role}`)
      console.log(`   isActive: ${user.isActive}`)
      console.log(`   forcePasswordChange: ${user.forcePasswordChange}`)
      console.log(`   Password stored: ${user.password ? 'Yes' : 'No'}`)
      console.log(`   Password is bcrypt: ${isBcryptHash ? 'Yes' : 'No (plain text!)'}`)
      if (user.password && !isBcryptHash) {
        console.log(`   ⚠️  Plain text password detected: "${user.password}"`)
      }
      console.log('')
    })

  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 Disconnected from MongoDB')
  }
}

listUsers()
