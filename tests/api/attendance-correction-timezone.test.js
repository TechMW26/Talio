import { parseDateTimeInTimezone } from '@/lib/timezone'

function getTimeParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23',
    }).formatToParts(date)

    return parts.reduce((accumulator, part) => {
        if (part.type !== 'literal') {
            accumulator[part.type] = part.value
        }
        return accumulator
    }, {})
}

describe('attendance correction timezone parsing', () => {
    test('keeps regularisation wall-clock times unchanged for Asia/Kolkata', () => {
        const checkIn = parseDateTimeInTimezone('2026-04-14T10:00:00', 'Asia/Kolkata')
        const checkOut = parseDateTimeInTimezone('2026-04-14T20:00:00', 'Asia/Kolkata')

        expect(checkIn?.toISOString()).toBe('2026-04-14T04:30:00.000Z')
        expect(checkOut?.toISOString()).toBe('2026-04-14T14:30:00.000Z')

        expect(getTimeParts(checkIn, 'Asia/Kolkata')).toMatchObject({ hour: '10', minute: '00' })
        expect(getTimeParts(checkOut, 'Asia/Kolkata')).toMatchObject({ hour: '20', minute: '00' })
    })

    test('does not reinterpret timestamps that already include an offset', () => {
        const parsed = parseDateTimeInTimezone('2026-04-14T10:00:00+05:30', 'America/New_York')

        expect(parsed?.toISOString()).toBe('2026-04-14T04:30:00.000Z')
    })

    test('supports DST-aware company timezones', () => {
        const parsed = parseDateTimeInTimezone('2026-07-04T09:00:00', 'America/New_York')

        expect(parsed?.toISOString()).toBe('2026-07-04T13:00:00.000Z')
        expect(getTimeParts(parsed, 'America/New_York')).toMatchObject({ hour: '09', minute: '00' })
    })
})