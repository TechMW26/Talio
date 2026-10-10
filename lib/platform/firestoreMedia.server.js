// Historical import names remain compatible, but application media metadata is
// Mongo-only. Source Firestore export/rollback tools live outside this runtime.
export {
  createMongoMediaRepository as createFirestoreMediaRepository,
  getMongoMediaRepository as getFirestoreMediaRepository,
} from './mongoMedia.server'
