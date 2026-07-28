'use client'

import { useState, useEffect, useMemo } from 'react'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Button,
    Input,
    Select,
    SelectItem,
    Chip,
    Divider,
    Skeleton,
    Tooltip,
} from '@heroui/react'
import {
    FaCalendarAlt,
    FaClock,
    FaCheck,
    FaTimes,
    FaEdit,
    FaSave,
    FaExclamationTriangle,
    FaCheckCircle,
    FaTimesCircle,
    FaUndo,
} from 'react-icons/fa'
import toast from '@/utils/toast'
import { getDateKeyInTimezone } from '@/lib/timezone'

const ATTENDANCE_STATUSES = [
    { key: 'present', label: 'Present', color: 'success' },
    { key: 'absent', label: 'Absent', color: 'danger' },
    { key: 'half-day', label: 'Half Day', color: 'warning' },
    { key: 'late', label: 'Late', color: 'warning' },
    { key: 'on-leave', label: 'On Leave', color: 'primary' },
    { key: 'wfh', label: 'WFH', color: 'secondary' },
    { key: 'holiday', label: 'Holiday', color: 'default' },
]

export default function AttendanceCorrectionModal({
    isOpen,
    onClose,
    employee,
    month,
    year,
    onCorrectionSaved,
}) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [attendanceRecords, setAttendanceRecords] = useState([])
    const [editingRecord, setEditingRecord] = useState(null)
    const [editedData, setEditedData] = useState({})
    const [corrections, setCorrections] = useState({}) // Track which records were corrected

    // Fetch attendance records for the employee
    useEffect(() => {
        if (isOpen && employee?._id) {
            fetchAttendanceRecords()
        }
    }, [isOpen, employee?._id, month, year])

    const fetchAttendanceRecords = async () => {
        setLoading(true)
        try {
            const token = localStorage.getItem('token')
            const response = await fetch(
                `/api/attendance?employeeId=${employee._id}&month=${month}&year=${year}&limit=50`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            )
            const data = await response.json()

            if (data.success) {
                // Sort by date descending
                const sorted = (data.data || []).sort(
                    (a, b) => new Date(b.date) - new Date(a.date)
                )
                setAttendanceRecords(sorted)

                // Initialize corrections state from records that have correctedAt
                const existingCorrections = {}
                sorted.forEach((record) => {
                    if (record.correctedAt) {
                        const dateKey = getDateKeyInTimezone(record.date)
                        existingCorrections[dateKey] = true
                    }
                })
                setCorrections(existingCorrections)
            } else {
                toast.error(data.message || 'Failed to fetch attendance records')
            }
        } catch (error) {
            console.error('Fetch attendance error:', error)
            toast.error('Failed to fetch attendance records')
        } finally {
            setLoading(false)
        }
    }

    // Generate all days in the month for reference
    const daysInMonth = useMemo(() => {
        const days = []
        const startDate = new Date(year, month - 1, 1)
        const endDate = new Date(year, month, 0)
        const today = new Date()
        today.setHours(23, 59, 59, 999)

        for (let d = new Date(startDate); d <= endDate && d <= today; d.setDate(d.getDate() + 1)) {
            days.push(new Date(d))
        }
        return days.reverse() // Show most recent first
    }, [month, year])

    // Map attendance records by date
    const attendanceByDate = useMemo(() => {
        const map = {}
        attendanceRecords.forEach((record) => {
            const dateKey = getDateKeyInTimezone(record.date)
            map[dateKey] = record
        })
        return map
    }, [attendanceRecords])

    const formatDate = (date) => {
        return new Date(date).toLocaleDateString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        })
    }

    const formatTime = (timeStr) => {
        if (!timeStr) return '--:--'
        // Handle ISO date string
        if (timeStr.includes('T')) {
            const date = new Date(timeStr)
            return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
        }
        // Handle HH:mm format
        const [hours, mins] = timeStr.split(':')
        const h = parseInt(hours)
        const ampm = h >= 12 ? 'PM' : 'AM'
        const h12 = h % 12 || 12
        return `${h12}:${mins} ${ampm}`
    }

    const getTimeInputValue = (timeStr) => {
        if (!timeStr) return ''
        // Handle ISO date string
        if (timeStr.includes('T')) {
            const date = new Date(timeStr)
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        }
        return timeStr
    }

    const handleStartEdit = (record, dateKey) => {
        setEditingRecord(dateKey)
        const checkIn = record?.checkIn ? getTimeInputValue(record.checkIn) : ''
        const checkOut = record?.checkOut ? getTimeInputValue(record.checkOut) : ''
        setEditedData({
            checkIn,
            checkOut,
            status: record?.status || 'absent',
            workHours: record?.workHours || 0,
            remarks: record?.remarks || '',
        })
    }

    const handleCancelEdit = () => {
        setEditingRecord(null)
        setEditedData({})
    }

    const calculateWorkHours = (checkIn, checkOut) => {
        if (!checkIn || !checkOut) return 0
        const [inH, inM] = checkIn.split(':').map(Number)
        const [outH, outM] = checkOut.split(':').map(Number)
        let hours = outH - inH + (outM - inM) / 60
        // Handle overnight shifts
        if (hours < 0) hours += 24
        return Math.max(0, Math.round(hours * 100) / 100)
    }

    const handleTimeChange = (field, value) => {
        const newData = { ...editedData, [field]: value }

        // Auto-calculate work hours when both times are set
        if (newData.checkIn && newData.checkOut) {
            newData.workHours = calculateWorkHours(newData.checkIn, newData.checkOut)

            // Auto-determine status based on work hours
            if (newData.workHours >= 7.5) {
                newData.status = 'present'
            } else if (newData.workHours >= 4) {
                newData.status = 'half-day'
            } else if (newData.workHours > 0) {
                newData.status = 'half-day'
            }
        }

        setEditedData(newData)
    }

    const handleSaveRecord = async (dateKey, existingRecord) => {
        setSaving(true)
        try {
            const token = localStorage.getItem('token')

            // Build the date object for this record
            const recordDate = new Date(dateKey)
            recordDate.setHours(0, 0, 0, 0)

            // Build checkIn/checkOut as full datetime
            let checkInDate = null
            let checkOutDate = null

            if (editedData.checkIn) {
                const [h, m] = editedData.checkIn.split(':').map(Number)
                checkInDate = new Date(recordDate)
                checkInDate.setHours(h, m, 0, 0)
            }

            if (editedData.checkOut) {
                const [h, m] = editedData.checkOut.split(':').map(Number)
                checkOutDate = new Date(recordDate)
                checkOutDate.setHours(h, m, 0, 0)
                // Handle overnight: if checkout is earlier than checkin, it's next day
                if (checkInDate && checkOutDate < checkInDate) {
                    checkOutDate.setDate(checkOutDate.getDate() + 1)
                }
            }

            const payload = {
                checkIn: checkInDate?.toISOString() || null,
                checkOut: checkOutDate?.toISOString() || null,
                status: editedData.status,
                workHours: editedData.workHours,
                remarks: editedData.remarks || '',
                correctedAt: new Date().toISOString(),
                correctedBy: 'payroll-admin',
            }

            let response
            if (existingRecord?._id) {
                // Update existing record
                response = await fetch(`/api/attendance/${existingRecord._id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify(payload),
                })
            } else {
                // Create new record for missing date (manual correction)
                response = await fetch('/api/attendance', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        ...payload,
                        employeeId: employee._id,
                        type: 'manual',
                        date: recordDate.toISOString(),
                    }),
                })
            }

            const data = await response.json()

            if (data.success) {
                toast.success('Attendance corrected successfully')

                // Mark this date as corrected in local state
                setCorrections((prev) => ({ ...prev, [dateKey]: true }))

                // Update the local attendance records immediately with the edited data
                setAttendanceRecords((prevRecords) => {
                    const updatedRecord = data.data || {
                        _id: existingRecord?._id || data.data?._id,
                        date: recordDate.toISOString(),
                        checkIn: checkInDate?.toISOString() || null,
                        checkOut: checkOutDate?.toISOString() || null,
                        status: editedData.status,
                        workHours: editedData.workHours,
                        remarks: editedData.remarks,
                        correctedAt: new Date().toISOString(),
                        correctedBy: 'payroll-admin',
                    }

                    // Find and update the existing record, or add new one
                    const existingIndex = prevRecords.findIndex(
                        (r) => getDateKeyInTimezone(r.date) === dateKey
                    )

                    if (existingIndex >= 0) {
                        const newRecords = [...prevRecords]
                        newRecords[existingIndex] = { ...newRecords[existingIndex], ...updatedRecord }
                        return newRecords
                    } else {
                        // Add new record and sort by date descending
                        return [...prevRecords, updatedRecord].sort(
                            (a, b) => new Date(b.date) - new Date(a.date)
                        )
                    }
                })

                setEditingRecord(null)
                setEditedData({})

                // Notify parent to refresh payroll data
                if (onCorrectionSaved) {
                    onCorrectionSaved(employee._id)
                }
            } else {
                toast.error(data.message || 'Failed to save correction')
            }
        } catch (error) {
            console.error('Save correction error:', error)
            toast.error('Failed to save correction')
        } finally {
            setSaving(false)
        }
    }

    const getStatusColor = (status) => {
        const found = ATTENDANCE_STATUSES.find((s) => s.key === status)
        return found?.color || 'default'
    }

    const getStatusLabel = (status) => {
        const found = ATTENDANCE_STATUSES.find((s) => s.key === status)
        return found?.label || status || 'No Record'
    }

    const correctedCount = Object.keys(corrections).length

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="4xl"
            scrollBehavior="inside"
            classNames={{
                base: 'max-h-[90vh]',
                body: 'p-0',
            }}
        >
            <ModalContent>
                <ModalHeader className="flex flex-col gap-1 border-b">
                    <div className="flex items-center justify-between w-full">
                        <div>
                            <h2 className="text-xl font-bold">
                                Attendance Correction - {employee?.firstName} {employee?.lastName}
                            </h2>
                            <p className="text-sm text-default-500">
                                {employee?.employeeCode} • {new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
                            </p>
                        </div>
                        {correctedCount > 0 && (
                            <Chip color="success" variant="flat" startContent={<FaCheckCircle />}>
                                {correctedCount} Corrected
                            </Chip>
                        )}
                    </div>
                </ModalHeader>

                <ModalBody className="p-4">
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="flex items-center gap-4 p-3 border rounded-lg">
                                    <Skeleton className="h-10 w-24 rounded" />
                                    <Skeleton className="h-10 flex-1 rounded" />
                                    <Skeleton className="h-10 w-20 rounded" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {/* Legend */}
                            <div className="flex flex-wrap gap-2 mb-4 p-3 bg-default-50 rounded-lg">
                                <span className="text-xs text-default-600 mr-2">Status Legend:</span>
                                {ATTENDANCE_STATUSES.map((s) => (
                                    <Chip key={s.key} size="sm" color={s.color} variant="flat">
                                        {s.label}
                                    </Chip>
                                ))}
                            </div>

                            {/* Attendance Records */}
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-default-100">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium text-default-600">Date</th>
                                            <th className="px-4 py-3 text-center font-medium text-default-600">Check In</th>
                                            <th className="px-4 py-3 text-center font-medium text-default-600">Check Out</th>
                                            <th className="px-4 py-3 text-center font-medium text-default-600">Work Hours</th>
                                            <th className="px-4 py-3 text-center font-medium text-default-600">Status</th>
                                            <th className="px-4 py-3 text-center font-medium text-default-600">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-default-200">
                                        {daysInMonth.map((day) => {
                                            const dateKey = getDateKeyInTimezone(day)
                                            const record = attendanceByDate[dateKey]
                                            const isEditing = editingRecord === dateKey
                                            const isWeekend = day.getDay() === 0 || day.getDay() === 6
                                            const wasCorrected = corrections[dateKey] || record?.correctedAt

                                            return (
                                                <tr
                                                    key={dateKey}
                                                    className={`${isWeekend ? 'bg-default-50' : ''} ${wasCorrected ? 'bg-success-50' : ''} ${isEditing ? 'bg-primary-50' : ''}`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <FaCalendarAlt className="text-default-400 w-3 h-3" />
                                                            <span className="font-medium">{formatDate(day)}</span>
                                                            {wasCorrected && (
                                                                <Tooltip content="Corrected">
                                                                    <Chip size="sm" color="success" variant="dot" className="h-5">
                                                                        Corrected
                                                                    </Chip>
                                                                </Tooltip>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {isEditing ? (
                                                        <>
                                                            <td className="px-4 py-2">
                                                                <Input
                                                                    type="time"
                                                                    size="sm"
                                                                    value={editedData.checkIn || ''}
                                                                    onChange={(e) => handleTimeChange('checkIn', e.target.value)}
                                                                    classNames={{ input: 'text-center' }}
                                                                />
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <Input
                                                                    type="time"
                                                                    size="sm"
                                                                    value={editedData.checkOut || ''}
                                                                    onChange={(e) => handleTimeChange('checkOut', e.target.value)}
                                                                    classNames={{ input: 'text-center' }}
                                                                />
                                                            </td>
                                                            <td className="px-4 py-2 text-center">
                                                                <Input
                                                                    type="number"
                                                                    size="sm"
                                                                    step="0.5"
                                                                    min="0"
                                                                    max="24"
                                                                    value={editedData.workHours?.toString() || '0'}
                                                                    onChange={(e) => setEditedData({ ...editedData, workHours: parseFloat(e.target.value) || 0 })}
                                                                    classNames={{ input: 'text-center', base: 'w-20 mx-auto' }}
                                                                />
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <Select
                                                                    size="sm"
                                                                    selectedKeys={[editedData.status || 'absent']}
                                                                    onSelectionChange={(keys) => setEditedData({ ...editedData, status: Array.from(keys)[0] })}
                                                                    classNames={{ trigger: 'min-h-8' }}
                                                                >
                                                                    {ATTENDANCE_STATUSES.map((s) => (
                                                                        <SelectItem key={s.key} textValue={s.label}>
                                                                            <Chip size="sm" color={s.color} variant="flat">
                                                                                {s.label}
                                                                            </Chip>
                                                                        </SelectItem>
                                                                    ))}
                                                                </Select>
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <Button
                                                                        size="sm"
                                                                        color="success"
                                                                        variant="flat"
                                                                        isIconOnly
                                                                        isLoading={saving}
                                                                        onPress={() => handleSaveRecord(dateKey, record)}
                                                                    >
                                                                        <FaSave />
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        color="danger"
                                                                        variant="flat"
                                                                        isIconOnly
                                                                        onPress={handleCancelEdit}
                                                                    >
                                                                        <FaTimes />
                                                                    </Button>
                                                                </div>
                                                            </td>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className={record?.checkIn ? 'text-success-600 font-medium' : 'text-default-400'}>
                                                                    {formatTime(record?.checkIn)}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className={record?.checkOut ? 'text-success-600 font-medium' : 'text-default-400'}>
                                                                    {formatTime(record?.checkOut)}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className={record?.workHours > 0 ? 'font-medium' : 'text-default-400'}>
                                                                    {record?.workHours ? `${record.workHours.toFixed(1)}h` : '--'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <Chip
                                                                    size="sm"
                                                                    color={record?.status ? getStatusColor(record.status) : 'default'}
                                                                    variant="flat"
                                                                >
                                                                    {getStatusLabel(record?.status)}
                                                                </Chip>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <Button
                                                                    size="sm"
                                                                    color="primary"
                                                                    variant="light"
                                                                    isIconOnly
                                                                    onPress={() => handleStartEdit(record, dateKey)}
                                                                >
                                                                    <FaEdit />
                                                                </Button>
                                                            </td>
                                                        </>
                                                    )}
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </ModalBody>

                <ModalFooter className="border-t">
                    <div className="flex items-center justify-between w-full">
                        <div className="text-sm text-default-500">
                            {correctedCount > 0 ? (
                                <span className="text-success-600 font-medium">
                                    <FaCheckCircle className="inline mr-1" />
                                    {correctedCount} record(s) corrected - Payroll data will be refreshed
                                </span>
                            ) : (
                                <span>Click the edit icon to correct any attendance record</span>
                            )}
                        </div>
                        <Button color="primary" variant="flat" onPress={onClose}>
                            Done
                        </Button>
                    </div>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
