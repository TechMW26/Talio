/**
 * Migration Script: Add Profile Completion Fields to Existing Users
 * 
 * This script adds the new profileCompletion fields to all existing users
 * who don't already have them. For users who have already logged in,
 * it sets their firstLoginAt to their lastLogin date and calculates
 * the deadline.
 * 
 * Run: node scripts/migrate-profile-completion.js
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') })
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not defined in environment variables')
  process.exit(1)
}

// User Schema (simplified for migration)
const UserSchema = new mongoose.Schema({
  email: String,
  isActive: Boolean,
  forcePasswordChange: Boolean,
  lastLogin: Date,
  profileCompletion: {
    status: {
      type: String,
      enum: ['incomplete', 'partially_complete', 'complete'],
      default: 'incomplete',
    },
    aadhaarFront: {
      url: String,
      uploadedAt: Date,
    },
    aadhaarBack: {
      url: String,
      uploadedAt: Date,
    },
    ocrVerification: {
      status: {
        type: String,
        enum: ['pending', 'verified', 'failed', 'mismatch'],
        default: 'pending',
      },
      extractedData: {
        name: String,
        dateOfBirth: String,
        aadhaarNumber: String,
        address: String,
      },
      mismatches: [{
        field: String,
        profileValue: String,
        aadhaarValue: String,
      }],
      verifiedAt: Date,
    },
    firstLoginAt: Date,
    profileCompletionDeadline: Date,
    completedAt: Date,
    completedFields: {
      personalInfo: { type: Boolean, default: false },
      aadhaarUploaded: { type: Boolean, default: false },
      ocrVerified: { type: Boolean, default: false },
    },
  },
  suspensionReason: {
    type: String,
    enum: ['profile_incomplete', 'admin_action', 'policy_violation', null],
  },
  suspendedAt: Date,
}, { timestamps: true })

async function migrate() {
  console.log('🚀 Starting Profile Completion Migration...\n')

  try {
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    const User = mongoose.models.User || mongoose.model('User', UserSchema)

    // Find all users without profileCompletion.status field
    const usersToMigrate = await User.find({
      $or: [
        { 'profileCompletion.status': { $exists: false } },
        { 'profileCompletion': { $exists: false } }
      ]
    })

    console.log(`📊 Found ${usersToMigrate.length} users to migrate\n`)

    if (usersToMigrate.length === 0) {
      console.log('✅ All users already have profileCompletion fields')
      await mongoose.disconnect()
      return
    }

    let updated = 0
    let skipped = 0

    for (const user of usersToMigrate) {
      try {
        const updateData = {
          'profileCompletion.status': 'incomplete',
          'profileCompletion.ocrVerification.status': 'pending',
          'profileCompletion.completedFields.personalInfo': false,
          'profileCompletion.completedFields.aadhaarUploaded': false,
          'profileCompletion.completedFields.ocrVerified': false,
        }

        // If user has already logged in and doesn't need password change,
        // set their firstLoginAt and deadline
        if (user.lastLogin && !user.forcePasswordChange) {
          const firstLogin = user.lastLogin
          const deadline = new Date(firstLogin)
          deadline.setDate(deadline.getDate() + 7) // 7 days from first login

          updateData['profileCompletion.firstLoginAt'] = firstLogin
          updateData['profileCompletion.profileCompletionDeadline'] = deadline
          
          console.log(`  📅 ${user.email}: Setting deadline to ${deadline.toISOString().split('T')[0]}`)
        } else {
          console.log(`  ⏳ ${user.email}: No deadline set (not logged in yet or needs password change)`)
        }

        await User.updateOne(
          { _id: user._id },
          { $set: updateData }
        )

        updated++
        console.log(`  ✅ Updated user: ${user.email}`)
      } catch (error) {
        console.error(`  ❌ Error updating user ${user.email}:`, error.message)
        skipped++
      }
    }

    console.log('\n📊 Migration Summary:')
    console.log(`   - Total users processed: ${usersToMigrate.length}`)
    console.log(`   - Successfully updated: ${updated}`)
    console.log(`   - Skipped/Errors: ${skipped}`)

    await mongoose.disconnect()
    console.log('\n✅ Migration completed successfully!')

  } catch (error) {
    console.error('❌ Migration failed:', error)
    await mongoose.disconnect()
    process.exit(1)
  }
}

migrate()
