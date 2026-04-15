import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createInstantInTimezone, getTimezone } from '../lib/timezone.js';
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '../lib/attendanceShrinkage.js';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const DEFAULT_FIX_CUTOFF = '2026-04-14T10:30:00.000Z';
const ONE_MINUTE_MS = 60 * 1000;
const FIELD_IMPROVEMENT_THRESHOLD = 120;

function log(level, message, extra) {
    const prefix = `[${new Date().toISOString()}] [attendance-timezone-backfill] [${level.toUpperCase()}]`;
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

function hasFlag(flag) {
    return process.argv.includes(flag);
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

function formatTimeInTimezone(value, timezone) {
    if (!value) return null;
    return new Date(value).toLocaleTimeString('en-IN', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
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

function parseClockMinutes(value, fallbackMinutes) {
    if (!value || typeof value !== 'string') return fallbackMinutes;
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallbackMinutes;
    return (hours * 60) + minutes;
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

function buildProposal(value, timezone, officeMinutes) {
    if (!value) return null;

    const current = new Date(value);
    const proposed = reinterpretUtcWallClock(value, timezone);
    if (!proposed) return null;

    const currentMinutes = getLocalClockMinutes(current, timezone);
    const proposedMinutes = getLocalClockMinutes(proposed, timezone);

    let improvementMinutes = 0;
    if (officeMinutes !== null && currentMinutes !== null && proposedMinutes !== null) {
        improvementMinutes = circularMinutesDifference(currentMinutes, officeMinutes) -
            circularMinutesDifference(proposedMinutes, officeMinutes);
    }

    return {
        current,
        proposed,
        currentLocalTime: formatTimeInTimezone(current, timezone),
        proposedLocalTime: formatTimeInTimezone(proposed, timezone),
        currentLocalDateTime: formatDateTimeInTimezone(current, timezone),
        proposedLocalDateTime: formatDateTimeInTimezone(proposed, timezone),
        improvementMinutes,
    };
}

function buildCandidate(correction, attendance, timezone, settings) {
    const officeCheckInMinutes = parseClockMinutes(settings?.checkInTime, null);
    const officeCheckOutMinutes = parseClockMinutes(settings?.checkOutTime, null);

    const requestedCheckIn = buildProposal(correction.requestedCheckIn, timezone, officeCheckInMinutes);
    const requestedCheckOut = buildProposal(correction.requestedCheckOut, timezone, officeCheckOutMinutes);

    const maxImprovement = Math.max(
        requestedCheckIn?.improvementMinutes || 0,
        requestedCheckOut?.improvementMinutes || 0,
    );

    const likelyShifted = maxImprovement >= FIELD_IMPROVEMENT_THRESHOLD;

    return {
        correction,
        attendance,
        timezone,
        officeCheckIn: settings?.checkInTime || null,
        officeCheckOut: settings?.checkOutTime || null,
        requestedCheckIn,
        requestedCheckOut,
        likelyShifted,
        maxImprovement,
    };
}

function toReportRow(candidate, employeeName) {
    return {
        correctionId: String(candidate.correction._id),
        employeeName,
        attendanceId: candidate.correction.attendance ? String(candidate.correction.attendance) : null,
        correctionType: candidate.correction.correctionType,
        correctionDate: candidate.correction.date,
        createdAt: candidate.correction.createdAt,
        timezone: candidate.timezone,
        officeCheckIn: candidate.officeCheckIn,
        officeCheckOut: candidate.officeCheckOut,
        likelyShifted: candidate.likelyShifted,
        maxImprovementMinutes: candidate.maxImprovement,
        reason: candidate.correction.reason || '',
        requestedCheckIn: candidate.requestedCheckIn ? {
            current: candidate.requestedCheckIn.current.toISOString(),
            currentLocal: candidate.requestedCheckIn.currentLocalDateTime,
            proposed: candidate.requestedCheckIn.proposed.toISOString(),
            proposedLocal: candidate.requestedCheckIn.proposedLocalDateTime,
            improvementMinutes: candidate.requestedCheckIn.improvementMinutes,
        } : null,
        requestedCheckOut: candidate.requestedCheckOut ? {
            current: candidate.requestedCheckOut.current.toISOString(),
            currentLocal: candidate.requestedCheckOut.currentLocalDateTime,
            proposed: candidate.requestedCheckOut.proposed.toISOString(),
            proposedLocal: candidate.requestedCheckOut.proposedLocalDateTime,
            improvementMinutes: candidate.requestedCheckOut.improvementMinutes,
        } : null,
        attendanceCurrent: candidate.attendance ? {
            checkIn: candidate.attendance.checkIn || null,
            checkOut: candidate.attendance.checkOut || null,
            status: candidate.attendance.status || null,
            workHours: candidate.attendance.workHours ?? null,
        } : null,
    };
}

async function discoverTenantDatabases(mongoUri) {
    const superadminUri = buildDatabaseUri(process.env.SUPERADMIN_DB_URI || mongoUri, 'talio_superadmin');
    const connection = await mongoose.createConnection(superadminUri, {
        maxPoolSize: 3,
        serverSelectionTimeoutMS: 10000,
        family: 4,
    }).asPromise();

    try {
        const tenants = await connection.collection('tenantcompanies')
            .find({ isActive: { $ne: false } }, { projection: { databaseName: 1, name: 1 } })
            .toArray();

        return tenants.map(tenant => ({
            databaseName: tenant.databaseName,
            companyName: tenant.name || tenant.databaseName,
        }));
    } finally {
        await connection.close();
    }
}

async function maybeWriteReport(reportFile, report) {
    if (!reportFile) return;
    const resolvedPath = resolve(process.cwd(), reportFile);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, JSON.stringify(report, null, 2));
    log('info', `Wrote report file: ${resolvedPath}`);
}

async function processDatabase({ mongoUri, databaseName, companyName, execute, correctionIds, limit, fixCutoff, reportFile }) {
    const connection = await mongoose.createConnection(buildDatabaseUri(mongoUri, databaseName), {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
        family: 4,
    }).asPromise();

    try {
        const settings = await connection.collection('companysettings').findOne({}) || {};
        const timezone = getTimezone(settings.timezone);

        const correctionQuery = {
            status: 'approved',
            createdAt: { $lt: fixCutoff },
            $or: [
                { requestedCheckIn: { $exists: true, $ne: null } },
                { requestedCheckOut: { $exists: true, $ne: null } },
            ],
        };

        if (correctionIds.length > 0) {
            correctionQuery._id = { $in: correctionIds.map(id => safeObjectId(id)).filter(Boolean) };
        }

        const corrections = await connection.collection('attendancecorrections').find(correctionQuery).toArray();
        if (corrections.length === 0) {
            const emptyReport = {
                databaseName,
                companyName,
                timezone,
                mode: execute ? 'execute' : 'dry-run',
                totalApprovedCorrectionsScanned: 0,
                likelyShiftedCount: 0,
                corrections: [],
            };
            await maybeWriteReport(reportFile, emptyReport);
            return emptyReport;
        }

        const attendanceIds = corrections
            .map(correction => safeObjectId(correction.attendance))
            .filter(Boolean);
        const employeeIds = corrections
            .map(correction => safeObjectId(correction.employee))
            .filter(Boolean);

        const attendances = await connection.collection('attendances')
            .find({ _id: { $in: attendanceIds } })
            .toArray();
        const employees = await connection.collection('employees')
            .find({ _id: { $in: employeeIds } }, { projection: { firstName: 1, lastName: 1, employeeCode: 1 } })
            .toArray();

        const attendanceMap = new Map(attendances.map(attendance => [String(attendance._id), attendance]));
        const employeeMap = new Map(employees.map(employee => [String(employee._id), employee]));

        const candidates = corrections
            .map(correction => buildCandidate(correction, attendanceMap.get(String(correction.attendance)), timezone, settings))
            .sort((left, right) => right.maxImprovement - left.maxImprovement);

        const reportRows = candidates.map(candidate => {
            const employee = employeeMap.get(String(candidate.correction.employee));
            const employeeName = employee
                ? [employee.firstName, employee.lastName].filter(Boolean).join(' ')
                : String(candidate.correction.employee || 'Unknown employee');
            return toReportRow(candidate, employeeName);
        });

        const likelyShiftedRows = reportRows.filter(row => row.likelyShifted);

        const report = {
            databaseName,
            companyName,
            timezone,
            mode: execute ? 'execute' : 'dry-run',
            fixCutoff: fixCutoff.toISOString(),
            officeCheckIn: settings.checkInTime || null,
            officeCheckOut: settings.checkOutTime || null,
            totalApprovedCorrectionsScanned: reportRows.length,
            likelyShiftedCount: likelyShiftedRows.length,
            corrections: reportRows,
            sample: reportRows.slice(0, limit),
        };

        if (!execute) {
            await maybeWriteReport(reportFile, report);
            return report;
        }

        if (correctionIds.length === 0) {
            throw new Error('Execute mode requires explicit --ids correctionId1,correctionId2,...');
        }

        let updatedCorrections = 0;
        let skippedCorrections = 0;
        const executionLog = [];

        for (const candidate of candidates) {
            const correctionId = String(candidate.correction._id);
            const attendance = candidate.attendance;
            const correctionUpdate = {};
            const attendanceUpdate = {};
            const skipReasons = [];
            const skippedFields = [];

            if (candidate.requestedCheckIn) {
                if (candidate.requestedCheckIn.improvementMinutes < FIELD_IMPROVEMENT_THRESHOLD) {
                    skippedFields.push('requestedCheckIn below improvement threshold');
                } else if (!attendance) {
                    skipReasons.push('linked attendance record not found');
                } else if (attendance.checkIn && !datesEqualToMinute(attendance.checkIn, candidate.correction.requestedCheckIn) && !datesEqualToMinute(attendance.checkIn, candidate.correction.appliedCheckIn)) {
                    skipReasons.push('attendance.checkIn diverged from correction before backfill');
                } else {
                    correctionUpdate.requestedCheckIn = candidate.requestedCheckIn.proposed;
                    attendanceUpdate.checkIn = candidate.requestedCheckIn.proposed;
                    correctionUpdate.appliedCheckIn = candidate.requestedCheckIn.proposed;
                }
            }

            if (candidate.requestedCheckOut) {
                if (candidate.requestedCheckOut.improvementMinutes < FIELD_IMPROVEMENT_THRESHOLD) {
                    skippedFields.push('requestedCheckOut below improvement threshold');
                } else if (!attendance) {
                    if (!skipReasons.includes('linked attendance record not found')) {
                        skipReasons.push('linked attendance record not found');
                    }
                } else if (attendance.checkOut && !datesEqualToMinute(attendance.checkOut, candidate.correction.requestedCheckOut) && !datesEqualToMinute(attendance.checkOut, candidate.correction.appliedCheckOut)) {
                    skipReasons.push('attendance.checkOut diverged from correction before backfill');
                } else {
                    correctionUpdate.requestedCheckOut = candidate.requestedCheckOut.proposed;
                    attendanceUpdate.checkOut = candidate.requestedCheckOut.proposed;
                    correctionUpdate.appliedCheckOut = candidate.requestedCheckOut.proposed;
                }
            }

            if (skipReasons.length > 0) {
                skippedCorrections += 1;
                executionLog.push({ correctionId, status: 'skipped', reasons: skipReasons });
                continue;
            }

            if (skipReasons.length === 0 && Object.keys(correctionUpdate).length === 0 && Object.keys(attendanceUpdate).length === 0) {
                skippedCorrections += 1;
                executionLog.push({ correctionId, status: 'skipped', reasons: skippedFields.length > 0 ? skippedFields : ['no field met improvement threshold'] });
                continue;
            }

            if (attendance && Object.keys(attendanceUpdate).length > 0) {
                const nextAttendance = {
                    ...attendance,
                    ...attendanceUpdate,
                };

                if (nextAttendance.checkIn && nextAttendance.checkOut) {
                    const workHoursCalc = calculateEffectiveWorkHours(
                        nextAttendance.checkIn,
                        nextAttendance.checkOut,
                        Array.isArray(settings.breakTimings) ? settings.breakTimings : []
                    );

                    const statusResult = determineAttendanceStatus(workHoursCalc.effectiveWorkHours, {
                        fullDayHours: settings.fullDayHours || 8,
                        halfDayHours: settings.halfDayHours || 4,
                    });

                    attendanceUpdate.workHours = workHoursCalc.effectiveWorkHours;
                    attendanceUpdate.totalLoggedHours = workHoursCalc.totalLoggedHours;
                    attendanceUpdate.breakMinutes = workHoursCalc.breakMinutes;
                    attendanceUpdate.shrinkagePercentage = workHoursCalc.shrinkagePercentage;
                    attendanceUpdate.status = statusResult.status;
                    attendanceUpdate.statusReason = `Corrected: ${statusResult.reason}`;
                }

                await connection.collection('attendances').updateOne(
                    { _id: attendance._id },
                    { $set: { ...attendanceUpdate, updatedAt: new Date() } }
                );
            }

            await connection.collection('attendancecorrections').updateOne(
                { _id: candidate.correction._id },
                { $set: { ...correctionUpdate, updatedAt: new Date() } }
            );

            updatedCorrections += 1;
            executionLog.push({
                correctionId,
                status: 'updated',
                requestedCheckIn: correctionUpdate.requestedCheckIn?.toISOString() || null,
                requestedCheckOut: correctionUpdate.requestedCheckOut?.toISOString() || null,
                skippedFields,
            });
        }

        report.updatedCorrections = updatedCorrections;
        report.skippedCorrections = skippedCorrections;
        report.executionLog = executionLog;

        await maybeWriteReport(reportFile, report);
        return report;
    } finally {
        await connection.close();
    }
}

async function main() {
    const mongoUri = process.env.MONGODB_URI || process.env.SUPERADMIN_DB_URI;
    if (!mongoUri) {
        throw new Error('MONGODB_URI or SUPERADMIN_DB_URI must be set');
    }

    const databaseName = getArg('--database');
    const execute = hasFlag('--execute');
    const allTenants = hasFlag('--all-tenants');
    const correctionIds = parseIdList(getArg('--ids'));
    const limit = Number(getArg('--limit') || 25);
    const reportFile = getArg('--report-file');
    const fixCutoff = new Date(getArg('--fix-cutoff') || DEFAULT_FIX_CUTOFF);

    if (Number.isNaN(fixCutoff.getTime())) {
        throw new Error('Invalid --fix-cutoff value');
    }

    if (!databaseName && !allTenants) {
        throw new Error('Pass --database <tenant_db_name> or --all-tenants');
    }

    if (execute && !databaseName) {
        throw new Error('Execute mode requires a single --database value');
    }

    const targets = databaseName
        ? [{ databaseName, companyName: databaseName }]
        : await discoverTenantDatabases(mongoUri);

    log('info', `Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
    log('info', `Targets: ${targets.map(target => target.databaseName).join(', ')}`);
    log('info', `Fix cutoff: ${fixCutoff.toISOString()}`);
    if (correctionIds.length > 0) {
        log('info', `Explicit correction IDs: ${correctionIds.join(', ')}`);
    }

    const summaries = [];
    for (const target of targets) {
        log('info', `Scanning ${target.databaseName}...`);
        const summary = await processDatabase({
            mongoUri,
            databaseName: target.databaseName,
            companyName: target.companyName,
            execute,
            correctionIds,
            limit,
            fixCutoff,
            reportFile: reportFile && targets.length === 1 ? reportFile : null,
        });
        summaries.push(summary);

        log('info', `Database ${target.databaseName}: ${summary.totalApprovedCorrectionsScanned} approved corrections scanned, ${summary.likelyShiftedCount} likely shifted candidates.`);
        if (!execute) {
            log('info', 'Top sample rows:', summary.sample.slice(0, Math.min(limit, 5)));
        } else {
            log('info', `Updated ${summary.updatedCorrections || 0}, skipped ${summary.skippedCorrections || 0}.`);
        }
    }

    if (targets.length > 1 && reportFile) {
        await maybeWriteReport(reportFile, { summaries });
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});