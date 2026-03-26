require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const base = process.env.MONGODB_URI;
  const uri = base.replace(/\/[^/?]*(\?|$)/, '/talio_company_mushroom_world_group$1');
  const conn = await mongoose.createConnection(uri).asPromise();
  const Session = conn.model('ProductivitySession', new mongoose.Schema({}, { strict: false }));

  const userId = new mongoose.Types.ObjectId('695b54ef26f3ff61eb685210');
  const dayStart = new Date('2026-03-19');
  const dayEnd = new Date('2026-03-20');

  // Check actual date values
  const sessions = await Session.find({
    user: userId,
    date: { $gte: dayStart, $lt: dayEnd },
    screenshotsDeleted: { $ne: true },
  }).sort({ sessionNumber: 1 }).lean();

  console.log(`Found ${sessions.length} sessions`);
  for (const s of sessions) {
    console.log(`\nSession #${s.sessionNumber} (${s._id}):`);
    console.log(`  date field: ${s.date}`);
    console.log(`  screenshotCount: ${s.screenshotCount}`);
    console.log(`  screenshots.length: ${s.screenshots?.length || 0}`);
    if (s.screenshots && s.screenshots.length > 0) {
      const first = s.screenshots[0];
      const last = s.screenshots[s.screenshots.length - 1];
      console.log(`  First screenshot keys: ${Object.keys(first).join(', ')}`);
      console.log(`  First: timestamp=${first.timestamp}, capturedAt=${first.capturedAt}`);
      console.log(`  Last: timestamp=${last.timestamp}, capturedAt=${last.capturedAt}`);
    }
    if (sessions.indexOf(s) >= 2) break; // Show first 3 only
  }

  // Also check whether the aggregation would find this user-date
  const agg = await Session.aggregate([
    { $match: { user: userId, screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $group: { _id: { user: '$user', date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } } } },
    { $sort: { '_id.date': 1 } }
  ]);
  console.log(`\nAggregation found ${agg.length} date combos for this user:`);
  for (const a of agg) console.log(`  ${a._id.date}`);

  await conn.close();
  process.exit(0);
})();
