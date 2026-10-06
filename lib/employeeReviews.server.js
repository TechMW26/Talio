import { randomBytes } from 'node:crypto'
import { readFirestoreReferences } from './platform/firestoreQueries.server'
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export async function populateEmployeeReviews(database, reviews) {
  const employees = await readFirestoreReferences(database, 'employees', reviews.map(review => review.reviewedBy))
  return reviews.map(review => {
    const reviewer = employees.get(String(review.reviewedBy))
    return { ...review, reviewedBy: reviewer ? { _id: reviewer._id, firstName: reviewer.firstName, lastName: reviewer.lastName, designation: reviewer.designation } : null }
  })
}
export async function listEmployeeReviews(database, actor, employeeId) {
  if (actor.role === 'employee' && String(actor.employeeId?._id || actor.employeeId) !== employeeId) fail('Access denied', 403)
  const employee = await database.get('employees', employeeId)
  if (!employee) fail('Employee not found', 404)
  return populateEmployeeReviews(database, [...(employee.reviews || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
}
export async function addEmployeeReview(database, actor, employeeId, input) {
  if (!['admin', 'hr', 'manager'].includes(actor.role)) fail('Access denied', 403)
  if (!['review', 'remark', 'feedback', 'warning', 'appreciation'].includes(input.type) || typeof input.content !== 'string' || !input.content.trim()) fail('Valid type and content are required')
  const rating = input.rating ? Number(input.rating) : null
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) fail('Rating must be between 1 and 5')
  const category = input.category || 'general'
  if (!['performance', 'behavior', 'skills', 'general'].includes(category)) fail('Invalid review category')
  const now = new Date(), review = { _id: randomBytes(12).toString('hex'), type: input.type, content: input.content.trim(), rating, category, reviewedBy: String(actor.employeeId?._id || actor.employeeId || '') || null, createdAt: now }
  if (!review.reviewedBy) fail('Reviewer must have a linked employee profile')
  await database.transaction(async tx => {
    const employee = await tx.get('employees', employeeId)
    const reviewer = await tx.get('employees', review.reviewedBy)
    if (!employee) fail('Employee not found', 404)
    if (!reviewer) fail('Reviewer profile not found')
    await tx.replace('employees', { ...employee, reviews: [...(employee.reviews || []), review], updatedAt: now })
  })
  return (await populateEmployeeReviews(database, [review]))[0]
}
export async function deleteEmployeeReview(database, actor, employeeId, reviewId) {
  if (!['admin', 'hr'].includes(actor.role)) fail('Access denied', 403)
  if (typeof reviewId !== 'string' || !/^[a-f\d]{24}$/i.test(reviewId)) fail('Valid review ID is required')
  const result = await database.mutate('employees', employeeId, employee => ({ ...employee, reviews: (employee.reviews || []).filter(review => String(review._id) !== reviewId), updatedAt: new Date() }))
  if (!result) fail('Employee not found', 404)
}
