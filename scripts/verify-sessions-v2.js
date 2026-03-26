require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const base = process.env.MONGODB_URI;
  const uri = base.replace(/\/[^/?]*(\?|$)/, '/talio_company_mushroom_world_group$1');
  const conn = await mongoose.createConnection(uri).asPromise();
  const Session = conn.model('ProductivitySession', new mongoose.Schema({}, { strict: false }));

  // 1. Count sessions that still have exactly 30 screenshots
  const thirtyCount = await Session.countDocuments({
    screenshotsDeleted: { $ne: true },
    screenshotCount: 30
  });

  // 2. Count total sessions
  const total = await Session.countDocuments({ screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } });

  // 3. Check maximum time span per session
  const maxSpan = await Session.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $project: {
      span: { $subtract: ['$endTime', '$startTime'] },
      screenshotCount: 1,
      sessionNumber: 1,
      user: 1
    }},
    { $sort: { span: -1 } },
    { $limit: 5 }
  ]);

  // 4. Count sessions by screenshotCount ranges
  const countDist = await Session.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $bucket: {
      groupBy: '$screenshotCount',
      boundaries: [1, 10, 20, 30, 31, 40, 50, 60, 70, 80],
      default: '80+',
      output: { count: { $sum: 1 } }
    }}
  ]);

  console.log(`Total sessions with screenshots: ${total}`);
  console.log(`Sessions with exactly 30 screenshots: ${thirtyCount}`);
  console.log('\nScreenshot count distribution:');
  for (const d of countDist) {
    console.log(`  ${d._id} screenshots: ${d.count} sessions`);
  }
  console.log('\nTop 5 sessions by time span:');
  for (const s of maxSpan) {
    const mins = Math.round(s.span / 60000);
    console.log(`  ${mins} min span, ${s.screenshotCount} screenshots, user ${s.user}, session #${s.sessionNumber}`);
  }

  // 5. Check specific user we know should have been modified
  const userId = new mongoose.Types.ObjectId('695b54ef26f3ff61eb685210');
  const userSessions = await Session.find({
    user: userId,
    screenshotsDeleted: { $ne: true },
    'screenshots.0': { $exists: true }
  }).sort({ date: 1, sessionNumber: 1 }).select('date sessionNumber screenshotCount').lean();

  console.log(`\nUser 695b54ef... sessions: ${userSessions.length}`);
  const byDate = {};
  for (const s of userSessions) {
    const d = new Date(s.date).toISOString().slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s.screenshotCount);
  }
  for (const [d, counts] of Object.entries(byDate)) {
    console.log(`  ${d}: ${counts.length} sessions [${counts.join(',')}]`);
  }

  await conn.close();
  process.exit(0);
})();
