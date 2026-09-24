export async function ensureProbationReviewReminder({ models, user, now = new Date() }) {
  if (!['hr', 'admin', 'superadmin', 'super_admin'].includes(user.role)) return
  const due = new Date(now.getTime() + 7 * 86400000)
  const employees = await models.Employee.find({
    status: { $in: ['active', 'probation'] },
    'lifecycle.probation.applicable': true,
    'lifecycle.probation.status': { $in: ['not_started', 'in_progress', 'extended'] },
    'lifecycle.probation.reviewDate': { $lte: due },
  }).select('_id firstName lastName lifecycle.probation.reviewDate').sort({ 'lifecycle.probation.reviewDate': 1 }).limit(50).lean()
  if (!employees.length) return
  const userId = user._id || user.userId || user.id
  const key = `probation-review:${now.toISOString().slice(0, 10)}`
  await models.ActionableNotification.findOneAndUpdate({ user: userId, 'metadata.reminderKey': key }, {
    $setOnInsert: {
      user: userId, title: 'Probation reviews due', type: 'generic', priority: 'high', status: 'pending',
      message: employees.map(employee => `${employee.firstName} ${employee.lastName} — ${new Date(employee.lifecycle.probation.reviewDate).toISOString().slice(0, 10)}`).join('\n') + '\nOpen the employee lifecycle panel to request manager approval.',
      url: '/dashboard/employees', metadata: { reminderKey: key },
      displaySettings: { persistent: true, showInBell: true, playSound: false, dismissible: true },
    },
  }, { upsert: true, setDefaultsOnInsert: true })
}
