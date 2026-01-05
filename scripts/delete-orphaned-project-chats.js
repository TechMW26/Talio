#!/usr/bin/env node

/**
 * Script to delete orphaned project chat groups
 * Usage: node scripts/delete-orphaned-project-chats.js [--dry-run]
 * 
 * This script finds chat groups that are linked to projects that no longer exist
 * and deletes them along with their messages.
 */

require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI

// Get database name from args or use default
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dbNameArg = args.find(a => a.startsWith('--db='))
const specificChatName = args.find(a => a.startsWith('--name='))?.replace('--name=', '')

async function main() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set')
    process.exit(1)
  }

  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(MONGODB_URI)
  console.log('✅ Connected')

  // Get list of databases (tenants)
  const admin = mongoose.connection.db.admin()
  const { databases } = await admin.listDatabases()
  
  const tenantDbs = databases
    .filter(db => db.name.startsWith('talio_'))
    .map(db => db.name)

  console.log(`\n📊 Found ${tenantDbs.length} tenant databases`)

  for (const dbName of tenantDbs) {
    console.log(`\n🔍 Checking database: ${dbName}`)
    
    const db = mongoose.connection.useDb(dbName)
    
    const Chat = db.model('Chat', new mongoose.Schema({
      name: String,
      type: String,
      project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
      participants: [{ type: mongoose.Schema.Types.ObjectId }]
    }, { collection: 'chats' }))

    const Message = db.model('Message_' + dbName, new mongoose.Schema({
      chat: { type: mongoose.Schema.Types.ObjectId },
      content: String
    }, { collection: 'messages' }))

    const Project = db.model('Project_' + dbName, new mongoose.Schema({
      name: String,
      chatGroup: { type: mongoose.Schema.Types.ObjectId }
    }, { collection: 'projects' }))

    // Find all project chat groups
    const projectChats = await Chat.find({ type: 'project' })
    console.log(`  Found ${projectChats.length} project chat groups`)

    let orphanedCount = 0
    let deletedCount = 0

    for (const chat of projectChats) {
      // Check if the linked project exists
      let projectExists = false
      
      if (chat.project) {
        const project = await Project.findById(chat.project)
        projectExists = !!project
      }

      // Also check if any project references this chat
      if (!projectExists) {
        const projectWithThisChat = await Project.findOne({ chatGroup: chat._id })
        projectExists = !!projectWithThisChat
      }

      // Check if name matches specific filter
      const matchesNameFilter = !specificChatName || 
        (chat.name && chat.name.toLowerCase().includes(specificChatName.toLowerCase()))

      if (!projectExists && matchesNameFilter) {
        orphanedCount++
        console.log(`  ⚠️  Orphaned chat: "${chat.name}" (ID: ${chat._id})`)

        if (!dryRun) {
          // Count and delete messages
          const messageCount = await Message.countDocuments({ chat: chat._id })
          await Message.deleteMany({ chat: chat._id })
          await Chat.findByIdAndDelete(chat._id)
          deletedCount++
          console.log(`     ✅ Deleted chat and ${messageCount} messages`)
        } else {
          const messageCount = await Message.countDocuments({ chat: chat._id })
          console.log(`     📝 Would delete chat and ${messageCount} messages (dry run)`)
        }
      }
    }

    if (orphanedCount > 0) {
      console.log(`  📊 Found ${orphanedCount} orphaned chats${dryRun ? '' : `, deleted ${deletedCount}`}`)
    } else {
      console.log(`  ✅ No orphaned chats found`)
    }
  }

  await mongoose.disconnect()
  console.log('\n✅ Done!')
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
