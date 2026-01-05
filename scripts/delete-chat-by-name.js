#!/usr/bin/env node

/**
 * Script to find and delete a specific chat by name pattern
 * Usage: node scripts/delete-chat-by-name.js "pattern"
 */

require('dotenv').config()
const mongoose = require('mongoose')

async function main() {
  const pattern = process.argv[2] || 'meethi'
  const dryRun = process.argv.includes('--dry-run')
  
  console.log(`Looking for chats matching: "${pattern}"`)
  if (dryRun) console.log('(DRY RUN - no changes will be made)')
  
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')
  
  const db = mongoose.connection.useDb('talio_company_mushroom_world_group')
  
  // Find all chats with pattern in name (case insensitive)
  const chats = await db.collection('chats').find({ 
    name: { $regex: pattern, $options: 'i' } 
  }).toArray()
  
  console.log(`Found ${chats.length} chats matching "${pattern}"`)
  
  for (const chat of chats) {
    console.log(`\nChat: "${chat.name}" (ID: ${chat._id}, Type: ${chat.type})`)
    
    // Check if project exists for this chat
    const project = await db.collection('projects').findOne({ chatGroup: chat._id })
    
    if (project) {
      console.log(`  ⚠️  Project exists: ${project.name} - skipping`)
    } else {
      console.log(`  ❌ No linked project found - this is an orphan`)
      
      if (!dryRun) {
        // Delete messages
        const msgResult = await db.collection('messages').deleteMany({ chat: chat._id })
        console.log(`  ✅ Deleted ${msgResult.deletedCount} messages`)
        
        // Delete chat
        await db.collection('chats').deleteOne({ _id: chat._id })
        console.log(`  ✅ Deleted chat`)
      } else {
        const msgCount = await db.collection('messages').countDocuments({ chat: chat._id })
        console.log(`  📝 Would delete ${msgCount} messages and the chat (dry run)`)
      }
    }
  }
  
  await mongoose.disconnect()
  console.log('\nDone!')
}

main().catch(console.error)
