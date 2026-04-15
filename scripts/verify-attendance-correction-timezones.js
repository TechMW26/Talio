import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createInstantInTimezone, getTimezone } from '../lib/timezone.js';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const ONE_MINUTE_MS = 60 * 1000;

function log(level, message, extra) {
    const prefix = `[${new Date().toISOString()}] [attendance-timezone-verify] [${level.toUpperCase()}]`;
    if (extra !== undefined) {
        console.log(prefix, message, extra);
        return;
    }
    console.log(prefix, message);
}

function getArg(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1) return null;
    return process.argv[index + 1] || null;
}

function parseIdList(rawValue) {
    return (rawValue || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function buildDatabaseUri(mongoUri, databaseName) {
    const match = mongoUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
    if (!match) {
        throw new Error('Invalid MongoDB URI format');
    }

    return `${match[1]}/${databaseName}${match[3] || ''}`;
}

function safeObjectId(id) {
    if (!id) return null;
    try {
        return new mongoose.Types.ObjectId(id);
    } catch {
        return null;
    }
}

function formatDateTimeInTimezone(value, timezone) {
    if (!value) return null;
    return new Date(value).toLocaleString('en-IN', {
        timeZone: timezone,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

function getLocalClockMinutes(value, timezone) {
    if (!value) return null;

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(value));

    const values = parts.reduce((accumulator, part) => {
        if (part.type !== 'literal') {
            accumulator[part.type] = Number(part.value);
        }
        return accumulator;
    }, {});

    if (!Number.isFinite(values.hour) || !Number.isFinite(values.minute)) {
        return null;
    }

    return (values.hour * 60) + values.minute;
}

function circularMinutesDifference(left, right) {
    const rawDifference = Math.abs(left - right);
    return Math.min(rawDifference, 1440 - rawDifference);
}

function parseClockMinutes(value, fallbackMinutes) {
    if (!value || typeof value !== 'string') return fallbackMinutes;
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallbackMinutes;
    return (hours * 60) + minutes;
}

function reinterpretUtcWallClock(value, timezone) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return createInstantInTimezone({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
        millisecond: date.getUTCMilliseconds(),
    }, timezone);
}

function datesEqualToMinute(left, right) {
    if (!left || !right) return false;
    return Math.abs(new Date(left).getTime() - new Date(right).getTime()) < ONE_MINUTE_MS;
}

function isBefore(left, right) {
    if (!left || !right) return false;
    return new Date(left).getTime() < new Date(right).getTime();
}

function inspectValue(value, timezone, officeMinutes) {
    if (!value) return null;

    const current = new Date(value);
    const reinterpreted = reinterpretUtcWallClock(value, timezone);
    const currentMinutes = getLocalClockMinutes(current, timezone);
    const reinterpretMinutes = reinterpreted ? getLocalClockMinutes(reinterpreted, timezone) : null;

    const improvementMinutes = officeMinutes !== null && currentMinutes !== null && reinterpretMinutes !== null
        ? circularMinutesDifference(currentMinutes, officeMinutes) - circularMinutesDifference(reinterpretMinutes, officeMinutes)
        : 0;

    return {
        iso: current.toISOString(),
        local: formatDateTimeInTimezone(current, timezone),
        reinterpretIso: reinterpreted ? reinterpreted.toISOString() : null,
        reinterpretLocal: reinterpreted ? formatDateTimeInTimezone(reinterpreted, timezone) : null,
        improvementMinutes,
        suspicious: improvementMinutes >= 120,
    };
}

async function maybeWriteReport(reportFile, report) {
    if (!reportFile) return;
    const resolvedPath = resolve(process.cwd(), reportFile);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, JSON.stringify(report, null, 2));
    log('info', `Wrote report file: ${resolvedPath}`);
}

async function main() {
    const mongoUri = process.env.MONGODB_URI || process.env.SUPERADMIN_DB_URI;
    if (!mongoUri) {
        throw new Error('MONGODB_URI or SUPERADMIN_DB_URI must be set');
    }

    const databaseName = getArg('--database');
    if (!databaseName) {
        throw new Error('Pass --database <tenant_db_name>');
    }

    const correctionIds = parseIdList(getArg('--ids'));
    const reportFile = getArg('--report-file');
    const limit = Number(getArg('--limit') || 25);

    const connection = await mongoose.createConnection(buildDatabaseUri(mongoUri, databaseName), {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
        family: 4,
    }).asPromise();

    try {
        const settings = await connection.collection('companysettings').findOne({}) || {};
        const timezone = getTimezone(settings.timezone);
        const officeCheckInMinutes = parseClockMinutes(settings.checkInTime, null);
        const officeCheckOutMinutes = parseClockMinutes(settings.checkOutTime, null);

        const query = {
            status: 'approved',
            $or: [
                { requestedCheckIn: { $exists: true, $ne: null } },
                { requestedCheckOut: { $exists: true, $ne: null } },
            ],
        };

        if (correctionIds.length > 0) {
            query._id = { $in: correctionIds.map(id => safeObjectId(id)).filter(Boolean) };
        }

        const corrections = await connection.collection('attendancecorrections').find(query).toArray();
        const attendanceIds = corrections.map(correction => safeObjectId(correction.attendance)).filter(Boolean);
        const employeeIds = corrections.map(correction => safeObjectId(correction.employee)).filter(Boolean);

        const [attendances, employees] = await Promise.all([
            connection.collection('attendances').find({ _id: { $in: attendanceIds } }).toArray(),
            connection.collection('employees').find({ _id: { $in: employeeIds } }, { projection: { firstName: 1, lastName: 1, employeeCode: 1 } }).toArray(),
        ]);

        const attendanceMap = new Map(attendances.map(attendance => [String(attendance._id), attendance]));
        const employeeMap = new Map(employees.map(employee => [String(employee._id), employee]));

        const rows = corrections.map(correction => {
            const attendance = attendanceMap.get(String(correction.attendance));
            const employee = employeeMap.get(String(correction.employee));
            const employeeName = employee
                ? [employee.firstName, employee.lastName].filter(Boolean).join(' ')
                : String(correction.employee || 'Unknown employee');

            const requestedCheckIn = inspectValue(correction.requestedCheckIn, timezone, officeCheckInMinutes);
            const requestedCheckOut = inspectValue(correction.requestedCheckOut, timezone, officeCheckOutMinutes);
            const appliedCheckIn = inspectValue(correction.appliedCheckIn, timezone, officeCheckInMinutes);
            const appliedCheckOut = inspectValue(correction.appliedCheckOut, timezone, officeCheckOutMinutes);
            const attendanceCheckIn = inspectValue(attendance?.checkIn, timezone, officeCheckInMinutes);
            const attendanceCheckOut = inspectValue(attendance?.checkOut, timezone, officeCheckOutMinutes);

            const flags = [];
            if (requestedCheckIn?.suspicious) flags.push('requestedCheckInStillShifted');
            if (requestedCheckOut?.suspicious) flags.push('requestedCheckOutStillShifted');
            if (appliedCheckIn?.suspicious) flags.push('appliedCheckInStillShifted');
            if (appliedCheckOut?.suspicious) flags.push('appliedCheckOutStillShifted');
            if (attendanceCheckIn?.suspicious) flags.push('attendanceCheckInStillShifted');
            if (attendanceCheckOut?.suspicious) flags.push('attendanceCheckOutStillShifted');

            if (correction.requestedCheckIn && attendance?.checkIn && !datesEqualToMinute(correction.requestedCheckIn, attendance.checkIn) && !datesEqualToMinute(correction.appliedCheckIn, attendance.checkIn)) {
                flags.push('attendanceCheckInDiffersFromCorrection');
            }
            if (correction.requestedCheckOut && attendance?.checkOut && !datesEqualToMinute(correction.requestedCheckOut, attendance.checkOut) && !datesEqualToMinute(correction.appliedCheckOut, attendance.checkOut)) {
                flags.push('attendanceCheckOutDiffersFromCorrection');
            }

            if (isBefore(correction.requestedCheckOut, correction.requestedCheckIn)) {
                flags.push('requestedCheckOutBeforeCheckIn');
            }
            if (isBefore(correction.appliedCheckOut, correction.appliedCheckIn)) {
                flags.push('appliedCheckOutBeforeCheckIn');
            }
            if (isBefore(attendance?.checkOut, attendance?.checkIn)) {
                flags.push('attendanceCheckOutBeforeCheckIn');
            }
            if (typeof attendance?.totalLoggedHours === 'number' && attendance.totalLoggedHours < 0) {
                flags.push('attendanceNegativeLoggedHours');
            }

            return {
                correctionId: String(correction._id),
                employeeName,
                attendanceId: correction.attendance ? String(correction.attendance) : null,
                correctionType: correction.correctionType,
                timezone,
                flags,
                requestedCheckIn,
                requestedCheckOut,
                appliedCheckIn,
                appliedCheckOut,
                attendanceCheckIn,
                attendanceCheckOut,
                attendanceStatus: attendance?.status || null,
                attendanceWorkHours: attendance?.workHours ?? null,
                reason: correction.reason || '',
            };
        });

        const suspicious = rows.filter(row => row.flags.length > 0);
        const report = {
            databaseName,
            timezone,
            totalChecked: rows.length,
            suspiciousCount: suspicious.length,
            rows,
            sample: rows.slice(0, limit),
            suspiciousSample: suspicious.slice(0, limit),
        };

        await maybeWriteReport(reportFile, report);

        log('info', `Checked ${rows.length} approved corrections.`);
        log('info', `Suspicious rows: ${suspicious.length}`);
        if (suspicious.length > 0) {
            log('info', 'Suspicious sample:', suspicious.slice(0, Math.min(limit, 10)).map(row => ({ correctionId: row.correctionId, employeeName: row.employeeName, flags: row.flags })));
        }
    } finally {
        await connection.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});