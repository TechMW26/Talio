'use strict'

// Native Mongo does not expand Firestore DNF clauses. Keep membership transport
// bounded to the same safe application batch size used by ordinary ID reads.
const MAX_MONGO_MEMBERSHIP_VALUES = 100

module.exports = { MAX_MONGO_MEMBERSHIP_VALUES }
