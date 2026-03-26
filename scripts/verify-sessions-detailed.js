require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const base = process.env.MONGODB_URI;
  const uri = base.replace(/\/[^/?]*(\?|$)/, '/talio_company_mushroom_world_group$1');
  const conn = await mongoose.createConnection(uri).asPromise();
  const Session = conn.model('ProductivitySession', new mongoose.Schema({}, { strict: false }));

  // Check a specific user that should have been modified (from dry run: 10 → 7)
  const userId = new mongoose.Types.ObjectId('695b54ef26f3ff61eb685210');
  const dayStart = new Date('2026-03-19');
  const dayEnd = new Date('2026-03-20');

  const sessions = await Session.find({
    user: userId,
    date: { $gte: dayStart, $lt: dayEnd },
    screenshotsDeleted: { $ne: true },
  }).sort({ sessionNumber: 1 }).select('sessionNumber screenshotCount estimatedDuration startTime endTime').lean();

  console.log(`User 695b54ef...85210 on 2026-03-19: ${sessions.length} sessions (expected: 7, was: 10)`);
  for (const s of sessions) {
    const st = s.startTime ? new Date(s.startTime).toISOString().slice(0, 16) : 'N/A';
    const et = s.endTime ? new Date(s.endTime).toISOString().slice(0, 16) : 'N/A';
    console.log(`  #${s.sessionNumber}: ${s.screenshotCount} screenshots, ~${s.estimatedDuration} min, ${st} -> ${et}`);
  }

  // Also check overall: count sessions per user-date for recent dates
  const grouped = await Session.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true }, date: { $gte: new Date('2026-03-25') } } },
    { $group: { _id: { user: '$user', date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } }, count: { $sum: 1 }, totalScreenshots: { $sum: '$screenshotCount' } } },
    { $sort: { totalScreenshots: -1 } },
    { $limit: 10 }
  ]);

  console.log('\nTop 10 user-dates by screenshot count (2026-03-25+):');
  for (const g of grouped) {
    console.log(`  User ${g._id.user} / ${g._id.date}: ${g.count} sessions, ${g.totalScreenshots} screenshots`);
  }

  // Check if any session has startTime-endTime > 60 mins
  const overSixty = await Session.countDocuments({
    screenshotsDeleted: { $ne: true },
    'screenshots.0': { $exists: true },
    $expr: { $gt: [{ $subtract: ['$endTime', '$startTime'] }, 60 * 60 * 1000] }
  });
  console.log(`\nSessions with span > 60 min: ${overSixty}`);

  await conn.close();
  process.exit(0);
})();
