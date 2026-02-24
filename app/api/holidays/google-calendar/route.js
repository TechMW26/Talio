import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Google Calendar Holiday Sync
 * 
 * Fetches public holidays from Google Calendar API and saves them to the database.
 * Uses the Google Calendar API v3 with a simple API key (no OAuth needed for public calendars).
 * 
 * Required env variables:
 *   GOOGLE_CALENDAR_API_KEY   — API key from Google Cloud Console
 *   GOOGLE_CALENDAR_COUNTRY   — Country code for holiday calendar (e.g. 'indian', 'usa', 'uk')
 * 
 * Calendar ID format: en.{country}#holiday@group.v.calendar.google.com
 * 
 * Common country codes for Google holiday calendars:
 *   indian, usa, uk, australian, canadian, french, german, japanese, etc.
 * 
 * POST /api/holidays/google-calendar
 *   Body: { year?: number, country?: string }
 *   - year defaults to current year
 *   - country defaults to GOOGLE_CALENDAR_COUNTRY env var
 * 
 * GET /api/holidays/google-calendar
 *   Returns current sync config status (whether API key is set, etc.)
 */

// Map Google Calendar event types to our holiday types
function mapEventType(description = '') {
    const lower = description.toLowerCase()
    if (lower.includes('optional') || lower.includes('restricted')) return 'optional'
    if (lower.includes('observance')) return 'optional'
    return 'public'
}

// Common country calendar ID mappings
const COUNTRY_CALENDAR_MAP = {
    // Full names → calendar slug
    'india': 'indian',
    'us': 'usa',
    'united states': 'usa',
    'united kingdom': 'uk',
    'australia': 'australian',
    'canada': 'canadian',
    'france': 'french',
    'germany': 'german',
    'japan': 'japanese',
    'china': 'chinese',
    'brazil': 'brazilian',
    'mexico': 'mexican',
    'south korea': 'south_korea',
    'singapore': 'singapore',
    'malaysia': 'malaysia',
    'indonesia': 'indonesian',
    'italy': 'italian',
    'spain': 'spanish',
    'netherlands': 'dutch',
    'sweden': 'swedish',
    'norway': 'norwegian',
    'denmark': 'danish',
    'finland': 'finnish',
    'portugal': 'portuguese',
    'russia': 'russian',
    'poland': 'polish',
    'turkey': 'turkish',
    'saudi arabia': 'sa',
    'uae': 'ae',
    'united arab emirates': 'ae',
    'new zealand': 'new_zealand',
    'south africa': 'south_africa',
    'thailand': 'thai',
    'philippines': 'philippines',
    'vietnam': 'vietnamese',
    'pakistan': 'pakistan',
    'bangladesh': 'bangladesh',
    'sri lanka': 'sri_lanka',
    'nepal': 'nepal',
}

function resolveCalendarId(country) {
    const lower = country.toLowerCase().trim()
    // Check if it's already a valid calendar slug
    const slug = COUNTRY_CALENDAR_MAP[lower] || lower
    return `en.${slug}%23holiday%40group.v.calendar.google.com`
}

// POST — Fetch holidays from Google Calendar and save to DB
export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Holiday'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { models } = auth
        const { Holiday } = models

        const body = await request.json().catch(() => ({}))
        const year = body.year || new Date().getFullYear()
        const country = body.country || process.env.GOOGLE_CALENDAR_COUNTRY || 'indian'

        const apiKey = process.env.GOOGLE_CALENDAR_API_KEY
        if (!apiKey) {
            return NextResponse.json(
                { success: false, message: 'Google Calendar API key not configured. Set GOOGLE_CALENDAR_API_KEY in environment variables.' },
                { status: 500 }
            )
        }

        // Build date range for the requested year
        const timeMin = new Date(year, 0, 1).toISOString()
        const timeMax = new Date(year, 11, 31, 23, 59, 59).toISOString()
        const calendarId = resolveCalendarId(country)

        const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
            `key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`

        console.log(`[Google Calendar] Fetching holidays for "${country}" (${year})...`)

        const response = await fetch(url)

        if (!response.ok) {
            const errorText = await response.text()
            console.error('[Google Calendar] API Error:', response.status, errorText)

            if (response.status === 403) {
                return NextResponse.json(
                    { success: false, message: 'Google Calendar API key is invalid or the Calendar API is not enabled. Enable it at https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' },
                    { status: 403 }
                )
            }
            if (response.status === 404) {
                return NextResponse.json(
                    { success: false, message: `Holiday calendar not found for country "${country}". Check the country code.` },
                    { status: 404 }
                )
            }

            return NextResponse.json(
                { success: false, message: `Google Calendar API returned ${response.status}` },
                { status: response.status }
            )
        }

        const data = await response.json()
        const events = data.items || []

        console.log(`[Google Calendar] Found ${events.length} holiday events`)

        // Process and save holidays
        let addedCount = 0
        let skippedCount = 0
        let updatedCount = 0
        const processedHolidays = []

        for (const event of events) {
            const name = event.summary
            if (!name) continue

            // Google Calendar returns date as YYYY-MM-DD for all-day events
            const dateStr = event.start?.date || event.start?.dateTime
            if (!dateStr) continue

            const holidayDate = new Date(dateStr)

            // Determine end date (for multi-day holidays)
            let endDate = null
            if (event.end?.date) {
                // Google Calendar all-day event end date is exclusive (next day)
                const rawEnd = new Date(event.end.date)
                rawEnd.setDate(rawEnd.getDate() - 1)
                // Only set endDate if it's different from start
                if (rawEnd.getTime() !== holidayDate.getTime()) {
                    endDate = rawEnd
                }
            }

            const holidayType = mapEventType(event.description || '')

            // Only sync public holidays
            if (holidayType !== 'public') {
                continue
            }

            const holidayData = {
                name,
                date: holidayDate,
                endDate,
                type: holidayType,
                description: event.description || `${name} - Public Holiday`,
                year: parseInt(year),
                applicableTo: 'all',
                isActive: true,
                source: 'google-calendar',
            }

            // Check if holiday already exists (by name + date)
            const existing = await Holiday.findOne({
                name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                date: {
                    $gte: new Date(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate()),
                    $lt: new Date(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate() + 1),
                },
            })

            if (existing) {
                // Update existing holiday with Google Calendar data
                existing.description = holidayData.description
                existing.type = holidayData.type
                existing.source = 'google-calendar'
                if (endDate) existing.endDate = endDate
                await existing.save()
                updatedCount++
            } else {
                await Holiday.create(holidayData)
                addedCount++
            }

            processedHolidays.push({
                name,
                date: holidayDate.toISOString().split('T')[0],
                type: holidayType,
            })

            skippedCount = events.length - addedCount - updatedCount
        }

        // Remove any non-public holidays previously synced from Google Calendar
        const cleanupResult = await Holiday.deleteMany({
            source: 'google-calendar',
            year: parseInt(year),
            type: { $ne: 'public' },
        })
        const removedCount = cleanupResult.deletedCount || 0
        if (removedCount > 0) {
            console.log(`[Google Calendar] Cleaned up ${removedCount} non-public holidays from DB`)
        }

        return NextResponse.json({
            success: true,
            message: `Google Calendar sync complete. Added ${addedCount} new holidays, updated ${updatedCount}, skipped ${skippedCount}, removed ${removedCount} non-public (${events.length} total from Google).`,
            data: {
                country,
                year,
                totalFromGoogle: events.length,
                added: addedCount,
                updated: updatedCount,
                skipped: skippedCount,
                removedNonPublic: removedCount,
                holidays: processedHolidays,
            },
        })
    } catch (error) {
        console.error('[Google Calendar] Sync error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to sync holidays from Google Calendar' },
            { status: 500 }
        )
    }
}

// GET — Check Google Calendar integration status
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Holiday'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }

        const apiKey = process.env.GOOGLE_CALENDAR_API_KEY
        const country = process.env.GOOGLE_CALENDAR_COUNTRY || 'indian'

        return NextResponse.json({
            success: true,
            data: {
                configured: !!apiKey,
                country,
                apiKeySet: !!apiKey,
                calendarId: `en.${country}#holiday@group.v.calendar.google.com`,
                instructions: !apiKey ? [
                    '1. Go to https://console.cloud.google.com/',
                    '2. Create or select a project',
                    '3. Enable the "Google Calendar API"',
                    '4. Go to Credentials → Create Credentials → API Key',
                    '5. (Optional) Restrict the key to Calendar API only',
                    '6. Set GOOGLE_CALENDAR_API_KEY in your .env file',
                    '7. Set GOOGLE_CALENDAR_COUNTRY (e.g. "indian", "usa", "uk")',
                ] : null,
            },
        })
    } catch (error) {
        console.error('[Google Calendar] Status check error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to check Google Calendar status' },
            { status: 500 }
        )
    }
}
