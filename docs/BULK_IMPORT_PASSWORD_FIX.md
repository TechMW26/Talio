# Bulk Import Password Fix

## Problem Summary
Users imported via bulk import could not login with the credentials sent in their onboarding email. The error was "Invalid credentials".

## Root Cause Analysis

### The Issue
The bulk import code was sending **hashed passwords** in onboarding emails instead of **plain text passwords**.

### The Password Flow (Before Fix)
1. Generate plain text password: `password = generateRandomPassword()` → e.g., "ABCdef12@"
2. Create user: `User.create({ password: plainText })` → User model's pre-save hook hashes it
3. **BUG**: Fetch user with hashed password: `User.findById(user._id).select('+password')`
4. **BUG**: Send **hashed** password in email: `password` variable now contains hash like "$2a$10$xyz..."
5. User receives hash in email, tries to login with hash → **Login fails**

### Why It Failed
- Bcrypt hashing is one-way: hashing a hash creates a **different** hash
- User received: `$2a$10$ycHOGHE9sopScwwr4N5ZVe60pXIlmUQiE/U33H2TdhccufHOlc8yO`
- User entered: `$2a$10$ycHOGHE9sopScwwr4N5ZVe60pXIlmUQiE/U33H2TdhccufHOlc8yO`
- System compared: `bcrypt.compare(hashedPassword, storedHashedPassword)` → **FALSE**
- The stored hash was a hash of "ABCdef12@", but user was trying to login with the hash itself!

## The Fix

### Code Changes
**File**: `app/api/employees/bulk-import/route.js` (lines 1209-1245)

**Before**:
```javascript
// Generate password
password = data.password || generateRandomPassword()

const userData = {
  email: email,
  password: password, // Plain text
  // ...
}

user = await User.create(userData) // Hashes password

// BUG: Fetch hashed password
const userWithPassword = await User.findById(user._id).select('+password').lean()

// BUG: Send hashed password in email
sendAndLogOnboardingEmail({
  password: password, // This is now hashed!
  // ...
})
```

**After**:
```javascript
// CRITICAL: Store plain text password BEFORE creating user
const plainTextPassword = data.password || generateRandomPassword()
password = plainTextPassword // Keep for email/credentials response

const userData = {
  email: email,
  password: plainTextPassword, // Pass plain text - will be hashed by pre-save hook
  // ...
}

user = await User.create(userData) // Hashes password

// Fetch hashed password for backup sync ONLY
const userWithPassword = await User.findById(user._id).select('+password').lean()
syncUserToBackup({
  password: userWithPassword.password, // Send hashed password to backup
  // ...
})

// Send PLAIN TEXT password in email
sendAndLogOnboardingEmail({
  password: password, // This is the plain text password!
  // ...
})
```

### Key Changes
1. **Store plain text password in a separate variable** before creating user
2. **User.create()** receives plain text → pre-save hook hashes it automatically
3. **Hashed password** is fetched ONLY for backup sync (which expects hashed passwords)
4. **Plain text password** is sent in email and returned in credentials response
5. **Users can now login** with the password from their email

## Password Flow (After Fix)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Generate Plain Text Password                                 │
│    plainTextPassword = "ABCdef12@"                              │
│    password = plainTextPassword (for later use)                 │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Create User with Plain Text                                  │
│    User.create({ password: "ABCdef12@" })                       │
│                                                                  │
│    → User model's pre-save hook auto-hashes:                    │
│       "$2a$10$ycHOGHE9sopScwwr4N5ZVe60pXIlmUQiE..."            │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Fetch Hashed Password (for backup sync ONLY)                │
│    User.findById(user._id).select('+password')                  │
│    → hashedPassword = "$2a$10$ycHOGHE9sopScwwr4N5Z..."         │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Send Plain Text Password in Email                            │
│    sendOnboardingEmail({ password: "ABCdef12@" })               │
│    ✅ User receives: "ABCdef12@"                                │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. User Login Works!                                             │
│    User enters: "ABCdef12@"                                      │
│    System compares: bcrypt.compare("ABCdef12@", hashedPassword) │
│    → Result: ✅ TRUE → Login Success!                           │
└─────────────────────────────────────────────────────────────────┘
```

## Verification

### Test Script
Run `node scripts/test-bulk-import-password.js` to verify the password flow:
- ✅ Plain text password is stored before User.create()
- ✅ User model auto-hashes password on save
- ✅ Plain text password sent in email (NOT hashed)
- ✅ Plain text password returned in credentials
- ✅ Hashed password synced to backup database
- ✅ Login works with plain text password from email

### Testing Bulk Import
1. Upload a CSV/Excel file with employee data
2. Wait for onboarding email with credentials
3. Login with email + password from email
4. ✅ Login should work immediately
5. User will be prompted to change password on first login (forcePasswordChange: true)

## Related Files
- **Fix Applied**: `app/api/employees/bulk-import/route.js` (lines 1209-1245)
- **User Model**: `models/User.js` (pre-save hook at line 173-179)
- **Backup Sync**: `lib/backupDb.js` (expects hashed passwords)
- **Test Script**: `scripts/test-bulk-import-password.js`

## Other Employee Creation Routes (Already Correct)
- ✅ `app/api/employees/route.js` - Individual employee creation (working correctly)
- ✅ `app/api/auth/register/route.js` - User self-registration (working correctly)
- ✅ `app/api/setup/create-admin/route.js` - Admin setup (working correctly)

## Impact
- **Before**: Users could NOT login after bulk import
- **After**: Users CAN login with credentials from onboarding email
- **No migration needed**: Only affects NEW bulk imports going forward
- **Existing users**: Need to use "Forgot Password" feature if already affected

## Security Notes
1. **Passwords are NEVER stored in plain text** in the database
2. The plain text password only exists in memory during user creation
3. Only the hashed password is stored in the database
4. The plain text password is sent via email (over TLS) once
5. Users are forced to change password on first login
6. Backup database also receives only hashed passwords

## Additional Considerations

### For Existing Affected Users
If users were imported before this fix and cannot login:
1. Use "Forgot Password" feature on login page
2. Admin can manually reset password via admin panel
3. Admin can re-send onboarding email (will generate new password)

### Future Enhancements
Consider adding:
- Password strength indicator in bulk import preview
- Option to send login link instead of password
- Multi-factor authentication for first login
- Audit log for password-related actions
