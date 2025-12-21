/**
 * Script to test password for a user
 * Run with: node scripts/test-password.js <email> <password>
 */

const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables')
  process.exit(1)
}

const email = process.argv[2]
const password = process.argv[3]

if (!email || !password) {
  console.log('Usage: node scripts/test-password.js <email> <password>')
  console.log('Example: node scripts/test-password.js admin@example.com MyPassword123')
  process.exit(1)
}

async function testPassword() {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    const db = mongoose.connection.db
    const usersCollection = db.collection('users')

    const user = await usersCollection.findOne({ email: email.toLowerCase() })

    if (!user) {
      console.error(`❌ User with email "${email}" not found`)
      process.exit(1)
    }

    console.log(`📋 Found user: ${user.email}`)
    console.log(`   Role: ${user.role}`)
    console.log(`   isActive: ${user.isActive}`)
    console.log(`   Password hash: ${user.password.substring(0, 30)}...`)

    console.log(`\n🔍 Testing password: "${password}"`)
    
    const isMatch = await bcrypt.compare(password, user.password)
    
    if (isMatch) {
      console.log(`✅ Password is CORRECT!`)
    } else {
      console.log(`❌ Password is INCORRECT!`)
      console.log(`\n💡 You can reset the password with:`)
      console.log(`   node scripts/reset-admin-password.js ${email} <new-password>`)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await mongoose.disconnect()
    console.log('\n🔌 Disconnected from MongoDB')
  }
}

testPassword()
