/**
 * Standalone test script for Google Calendar Holiday integration
 * Run: node scripts/test-google-calendar.js
 */

require('dotenv').config();

const API_KEY = process.env.GOOGLE_CALENDAR_API_KEY;
const COUNTRY = process.env.GOOGLE_CALENDAR_COUNTRY || 'indian';
const YEAR = 2026;

async function testGoogleCalendar() {
    console.log('========================================');
    console.log('Google Calendar Holiday Integration Test');
    console.log('========================================\n');

    // Step 1: Check env
    console.log('1️⃣  Environment Check:');
    console.log('   API Key:', API_KEY ? `${API_KEY.substring(0, 10)}...✅` : '❌ NOT SET');
    console.log('   Country:', COUNTRY);
    console.log('');

    if (!API_KEY) {
        console.error('❌ GOOGLE_CALENDAR_API_KEY not set in .env');
        process.exit(1);
    }

    // Step 2: Fetch from Google Calendar
    const calendarId = `en.${COUNTRY}%23holiday%40group.v.calendar.google.com`;
    const timeMin = new Date(YEAR, 0, 1).toISOString();
    const timeMax = new Date(YEAR, 11, 31, 23, 59, 59).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?key=${API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`;

    console.log('2️⃣  Fetching from Google Calendar API...');

    const response = await fetch(url);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API Error ${response.status}:`, errorText);
        process.exit(1);
    }

    const data = await response.json();
    const events = data.items || [];

    console.log(`   ✅ Got ${events.length} holiday events for ${YEAR}\n`);

    // Step 3: Filter upcoming
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = events.filter(e => new Date(e.start.date || e.start.dateTime) >= today);
    const past = events.filter(e => new Date(e.start.date || e.start.dateTime) < today);

    console.log('3️⃣  Filtering Results:');
    console.log(`   Total:    ${events.length}`);
    console.log(`   Past:     ${past.length} (will be filtered out in widget)`);
    console.log(`   Upcoming: ${upcoming.length} (will be shown in widget)\n`);

    // Step 4: Show upcoming holidays
    console.log('4️⃣  Upcoming Indian Holidays (from today):');
    upcoming.forEach((e, i) => {
        console.log(`   ${(i + 1).toString().padStart(2)}. 📅 ${e.start.date}  ${e.summary}`);
    });
    console.log('');

    // Step 5: Test DB document shape
    console.log('5️⃣  Sample DB Document (what gets saved to MongoDB):');
    if (upcoming[0]) {
        const sample = upcoming[0];
        const holidayDate = new Date(sample.start.date);
        const doc = {
            name: sample.summary,
            date: holidayDate.toISOString(),
            type: 'public',
            description: sample.description ? sample.description.split('\n')[0] : `${sample.summary} - Public Holiday`,
            year: YEAR,
            applicableTo: 'all',
            isActive: true,
            source: 'google-calendar',
        };
        console.log('  ', JSON.stringify(doc, null, 2).split('\n').join('\n   '));
    }
    console.log('');

    // Step 6: Test DB write (actual MongoDB save)
    console.log('6️⃣  Testing MongoDB Save...');
    try {
        const mongoose = require('mongoose');
        const MONGODB_URI = process.env.MONGODB_URI;

        if (!MONGODB_URI) {
            console.log('   ⚠️  MONGODB_URI not set, skipping DB test');
            return;
        }

        await mongoose.connect(MONGODB_URI);
        console.log('   ✅ Connected to MongoDB');

        // Find the first tenant DB (same pattern the web app uses)
        const adminDb = mongoose.connection.db.admin();
        const { databases } = await adminDb.listDatabases();
        const tenantDbs = databases.filter(db => db.name.startsWith('talio_company_'));

        if (tenantDbs.length === 0) {
            console.log('   ⚠️  No tenant databases found (looking for talio_company_*)');
            // Try just listing all non-system databases
            const allDbs = databases.filter(db => !['admin', 'config', 'local'].includes(db.name));
            console.log('   Available databases:', allDbs.map(d => d.name).join(', '));
            await mongoose.disconnect();
            return;
        }

        const tenantDbName = tenantDbs[0].name;
        console.log(`   Using tenant DB: ${tenantDbName}`);

        const tenantConnection = mongoose.connection.useDb(tenantDbName);
        const Holiday = tenantConnection.model('Holiday', new mongoose.Schema({
            name: String,
            date: Date,
            endDate: Date,
            type: String,
            isActive: Boolean,
            year: Number,
            description: String,
            source: String,
            applicableTo: String,
        }, { timestamps: true, strict: false }));

        // Count existing
        const existingCount = await Holiday.countDocuments({});
        console.log(`   Existing holidays in DB: ${existingCount}`);

        // Do the actual sync
        let addedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (const event of events) {
            const name = event.summary;
            if (!name) continue;

            const dateStr = event.start?.date || event.start?.dateTime;
            if (!dateStr) continue;

            const holidayDate = new Date(dateStr);

            let endDate = null;
            if (event.end?.date) {
                const rawEnd = new Date(event.end.date);
                rawEnd.setDate(rawEnd.getDate() - 1);
                if (rawEnd.getTime() !== holidayDate.getTime()) {
                    endDate = rawEnd;
                }
            }

            const desc = event.description || '';
            let holidayType = 'public';
            if (desc.toLowerCase().includes('observance')) holidayType = 'optional';
            if (desc.toLowerCase().includes('optional') || desc.toLowerCase().includes('restricted')) holidayType = 'optional';

            // Check if exists
            const existing = await Holiday.findOne({
                name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                date: {
                    $gte: new Date(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate()),
                    $lt: new Date(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate() + 1),
                },
            });

            if (existing) {
                existing.description = desc.split('\n')[0] || `${name} - Public Holiday`;
                existing.type = holidayType;
                existing.source = 'google-calendar';
                if (endDate) existing.endDate = endDate;
                await existing.save();
                updatedCount++;
            } else {
                await Holiday.create({
                    name,
                    date: holidayDate,
                    endDate,
                    type: holidayType,
                    description: desc.split('\n')[0] || `${name} - Public Holiday`,
                    year: YEAR,
                    applicableTo: 'all',
                    isActive: true,
                    source: 'google-calendar',
                });
                addedCount++;
            }
        }

        skippedCount = events.length - addedCount - updatedCount;

        console.log(`\n   📊 Sync Results:`);
        console.log(`      Added:   ${addedCount} new holidays`);
        console.log(`      Updated: ${updatedCount} existing holidays`);
        console.log(`      Total in DB now: ${await Holiday.countDocuments({})}`);

        // Verify: fetch upcoming from DB
        const upcomingFromDb = await Holiday.find({
            date: { $gte: today },
        }).sort({ date: 1 }).limit(5);

        console.log(`\n   📋 Next 5 upcoming holidays from DB:`);
        upcomingFromDb.forEach((h, i) => {
            console.log(`      ${i + 1}. ${h.date.toISOString().split('T')[0]} - ${h.name} (${h.type}) [source: ${h.source || 'manual'}]`);
        });

        await mongoose.disconnect();
        console.log('\n   ✅ MongoDB disconnected');

    } catch (dbErr) {
        console.error('   ❌ DB Error:', dbErr.message);
    }

    console.log('\n========================================');
    console.log('✅ Integration test complete!');
    console.log('========================================');
}

testGoogleCalendar().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
