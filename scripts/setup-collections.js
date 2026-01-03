const mongoose = require('mongoose');
require('dotenv').config();

async function setupDB() {
  console.log('🔄 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Connected to MongoDB!');
  
  const db = mongoose.connection.db;
  
  const collections = [
    'users', 'employees', 'departments', 'designations', 'leavetypes',
    'leaves', 'attendances', 'payrolls', 'announcements', 'policies',
    'assets', 'expenses', 'travels', 'helpdesks', 'tasks', 'chats',
    'chatmessages', 'notifications', 'documents', 'performances',
    'recruitments', 'candidates', 'miramessages', 'miraactionlogs',
    'miraformatteddatas', 'activitylogs', 'screenshots', 'settings',
    'shifts', 'holidays', 'leavebalances', 'overtimes', 'payrollsettings'
  ];
  
  const existing = await db.listCollections().toArray();
  const existingNames = existing.map(c => c.name);
  console.log('📂 Existing collections:', existingNames.length);
  
  let created = 0;
  for (const col of collections) {
    if (!existingNames.includes(col)) {
      await db.createCollection(col);
      console.log('  ✅ Created:', col);
      created++;
    }
  }
  
  if (created === 0) {
    console.log('  📝 All collections already exist');
  }
  
  console.log('\n✅ Database setup complete!');
  await mongoose.connection.close();
  process.exit(0);
}

setupDB().catch(err => { 
  console.error('❌ Error:', err.message); 
  process.exit(1); 
});
