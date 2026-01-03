const mongoose = require('mongoose');
require('dotenv').config();

async function deleteOldData() {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('URI exists:', !!uri);
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');
    
    // Delete MiraScreenSummary data
    const miraResult = await mongoose.connection.db.collection('mirascreensummaries').deleteMany({});
    console.log('Deleted MiraScreenSummary:', miraResult.deletedCount, 'documents');
    
    // Delete ProductivityData 
    const prodResult = await mongoose.connection.db.collection('productivitydatas').deleteMany({});
    console.log('Deleted ProductivityData:', prodResult.deletedCount, 'documents');
    
    await mongoose.disconnect();
    console.log('Done! All raw capture data has been deleted.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

deleteOldData();
