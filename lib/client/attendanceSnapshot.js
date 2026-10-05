// A read replica, cached dashboard response or in-flight GET must not undo a
// successful punch. The fence expires on the next attendance day.
export function canApplyAttendanceSnapshot(incoming, confirmed, day) {
  if (!confirmed || confirmed.day !== day) return true
  const record = confirmed.record
  if (record?.checkIn && !incoming?.checkIn) return false
  if (record?.checkOut && !incoming?.checkOut) return false
  if (record?._id && incoming?._id && String(record._id) !== String(incoming._id)) return false
  if (record?.updatedAt && incoming?.updatedAt && +new Date(incoming.updatedAt) < +new Date(record.updatedAt)) return false
  return true
}
