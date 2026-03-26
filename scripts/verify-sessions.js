require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const base = process.env.MONGODB_URI;
  const uri = base.replace(/\/[^/?]*(\?|$)/, '/talio_company_mushroom_world_group$1');
  const conn = await mongoose.createConnection(uri).asPromise();
  const Session = conn.model('ProductivitySession', new mongoose.Schema({}, { strict: false }));

  const total = await Session.countDocuments({ screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } });

  const samples = await Session.find({ screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } })
    .select('user date sessionNumber screenshotCount estimatedDuration startTime endTime')
    .sort({ date: -1 }).limit(15).lean();

  console.log('Total sessions with screenshots:', total);
  console.log('\nRecent sessions sample:');
  for (const s of samples) {
    const st = s.startTime ? new Date(s.startTime).toISOString().slice(0, 16) : 'N/A';
    const et = s.endTime ? new Date(s.endTime).toISOString().slice(0, 16) : 'N/A';
    console.log(`  Session #${s.sessionNumber}: ${s.screenshotCount} screenshots, ~${s.estimatedDuration} min, ${st} -> ${et}`);
  }

  const durations = await Session.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $bucket: { groupBy: '$estimatedDuration', boundaries: [0, 15, 30, 45, 60, 90, 120, 180, 300], default: '300+', output: { count: { $sum: 1 } } } }
  ]);
  console.log('\nDuration distribution (minutes):');
  for (const d of durations) {
    const label = typeof d._id === 'number' ? `${d._id}-${d._id + 14}` : d._id;
    console.log(`  ${label} min: ${d.count} sessions`);
  }

  await conn.close();
  process.exit(0);
})();
