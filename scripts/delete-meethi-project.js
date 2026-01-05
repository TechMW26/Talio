#!/usr/bin/env node

/**
 * Script to delete the Meethi Golee Revamp project and all related data
 */

require('dotenv').config()
const mongoose = require('mongoose')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')
  
  const db = mongoose.connection.useDb('talio_company_mushroom_world_group')
  
  // Find the project
  const project = await db.collection('projects').findOne({ 
    name: { $regex: 'meethi golee revamp', $options: 'i' } 
  })
  
  if (!project) {
    console.log('Project not found')
    await mongoose.disconnect()
    return
  }
  
  console.log('Found project:', project.name, '| ID:', project._id)
  console.log('Chat Group:', project.chatGroup)
  
  const projectId = project._id
  
  // Delete task assignees for tasks in this project
  const tasks = await db.collection('tasks').find({ project: projectId }).toArray()
  const taskIds = tasks.map(t => t._id)
  if (taskIds.length > 0) {
    const assigneeResult = await db.collection('taskassignees').deleteMany({ task: { $in: taskIds } })
    console.log('Deleted', assigneeResult.deletedCount, 'task assignees')
  }
  
  // Delete tasks
  const taskResult = await db.collection('tasks').deleteMany({ project: projectId })
  console.log('Deleted', taskResult.deletedCount, 'tasks')
  
  // Delete project members
  const memberResult = await db.collection('projectmembers').deleteMany({ project: projectId })
  console.log('Deleted', memberResult.deletedCount, 'project members')
  
  // Delete project notes
  const noteResult = await db.collection('projectnotes').deleteMany({ project: projectId })
  console.log('Deleted', noteResult.deletedCount, 'project notes')
  
  // Delete timeline events
  const timelineResult = await db.collection('projecttimelineevents').deleteMany({ project: projectId })
  console.log('Deleted', timelineResult.deletedCount, 'timeline events')
  
  // Delete completion approvals
  const approvalResult = await db.collection('projectcompletionapprovals').deleteMany({ project: projectId })
  console.log('Deleted', approvalResult.deletedCount, 'completion approvals')
  
  // Delete chat messages and chat
  if (project.chatGroup) {
    const msgResult = await db.collection('messages').deleteMany({ chat: project.chatGroup })
    console.log('Deleted', msgResult.deletedCount, 'messages')
    
    const chatResult = await db.collection('chats').deleteOne({ _id: project.chatGroup })
    console.log('Deleted', chatResult.deletedCount, 'chat')
  }
  
  // Delete project
  const projResult = await db.collection('projects').deleteOne({ _id: projectId })
  console.log('Deleted', projResult.deletedCount, 'project')
  
  console.log('\n✅ Done! Project and all related data deleted.')
  await mongoose.disconnect()
}

main().catch(console.error)
