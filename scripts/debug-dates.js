require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const base = process.env.MONGODB_URI;
  const uri = base.replace(/\/[^/?]*(\?|$)/, '/talio_company_mushroom_world_group$1');
  const conn = await mongoose.createConnection(uri).asPromise();
  const Session = conn.model('ProductivitySession', new mongoose.Schema({}, { strict: false }));

  // Check actual date field values
  const samples = await Session.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%dT%H:%M:%S', date: '$date' } },
      count: { $sum: 1 }
    }},
    { $sort: { _id: 1 } },
    { $limit: 20 }
  ]);

  console.log('Actual date values stored (UTC):');
  for (const s of samples) {
    console.log(`  ${s._id}Z = ${s.count} sessions`);
  }

  // Show what the aggregation returns in the script vs actual date values
  const userDateCombos = await Session.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $group: { _id: { user: '$user', date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } } } },
    { $sort: { '_id.date': 1 } },
    { $limit: 5 }
  ]);

  console.log('\nSample user-date combos from aggregation:');
  for (const c of userDateCombos) {
    const dateStr = c._id.date;
    const dayStart = new Date(dateStr);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const found = await Session.countDocuments({
      user: c._id.user,
      date: { $gte: dayStart, $lt: dayEnd },
      screenshotsDeleted: { $ne: true },
      'screenshots.0': { $exists: true }
    });

    console.log(`  User ${c._id.user} / ${dateStr}: aggregation groups here, find() returns ${found}`);
  }

  // Show raw date field for first session  
  const rawSession = await Session.findOne({ screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } }).select('date').lean();
  console.log('\nRaw date field:', rawSession.date);
  console.log('Date ISO:', rawSession.date.toISOString());
  console.log('Date valueOf:', rawSession.date.valueOf());

  await conn.close();
  process.exit(0);
})();
