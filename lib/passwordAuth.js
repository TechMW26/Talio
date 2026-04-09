import bcrypt from 'bcryptjs'

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export function isBcryptHash(value) {
  return typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value)
}

export function needsPasswordHashUpgrade(storedPassword) {
  return typeof storedPassword === 'string' && storedPassword.length > 0 && !isBcryptHash(storedPassword)
}

export async function compareStoredPassword(enteredPassword, storedPassword) {
  if (typeof enteredPassword !== 'string' || typeof storedPassword !== 'string') {
    return false
  }

  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(enteredPassword, storedPassword)
  }

  return enteredPassword === storedPassword
}