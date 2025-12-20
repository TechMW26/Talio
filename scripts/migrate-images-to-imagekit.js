/**
 * Migration script to convert existing base64 images to ImageKit URLs
 * 
 * This script:
 * 1. Finds all documents with base64 image data
 * 2. Uploads them to ImageKit
 * 3. Updates the database with ImageKit URLs
 * 4. Optionally removes old base64 data to save database space
 * 
 * Usage:
 *   node scripts/migrate-images-to-imagekit.js [--dry-run] [--model=Employee]
 * 
 * Options:
 *   --dry-run    Preview changes without making them
 *   --model      Specific model to migrate (Employee, User, ProductivitySession)
 *   --limit      Limit number of documents to process
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Import ImageKit helper
import { uploadImageToImageKit } from '../lib/imagekit.js';

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const modelArg = args.find(arg => arg.startsWith('--model='));
const specificModel = modelArg ? modelArg.split('=')[1] : null;
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100;

console.log('='.repeat(60));
console.log('ImageKit Migration Script');
console.log('='.repeat(60));
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log(`Model: ${specificModel || 'All'}`);
console.log(`Limit: ${limit} documents per model`);
console.log('='.repeat(60));

/**
 * Check if a string is base64 image data
 */
function isBase64Image(str) {
    if (!str || typeof str !== 'string') return false;
    return str.startsWith('data:image/') && str.includes(';base64,');
}

/**
 * Extract image format from base64 string
 */
function getImageFormat(base64) {
    const match = base64.match(/data:image\/(\w+);base64,/);
    return match ? match[1] : 'webp';
}

/**
 * Migrate Employee profile pictures
 */
async function migrateEmployeeProfilePictures() {
    if (specificModel && specificModel !== 'Employee') return { processed: 0, migrated: 0, errors: 0 };

    console.log('\n📷 Migrating Employee Profile Pictures...');

    const Employee = mongoose.model('Employee', new mongoose.Schema({}, { strict: false }));

    const employees = await Employee.find({
        profilePicture: { $regex: '^data:image/' }
    }).limit(limit).lean();

    console.log(`Found ${employees.length} employees with base64 profile pictures`);

    let migrated = 0;
    let errors = 0;

    for (const employee of employees) {
        try {
            console.log(`  Processing: ${employee.firstName} ${employee.lastName} (${employee.employeeCode})`);

            if (!isBase64Image(employee.profilePicture)) {
                console.log(`    Skipped: Not a valid base64 image`);
                continue;
            }

            if (isDryRun) {
                console.log(`    [DRY RUN] Would upload to ImageKit`);
                migrated++;
                continue;
            }

            // Upload to ImageKit
            const format = getImageFormat(employee.profilePicture);
            const result = await uploadImageToImageKit(employee.profilePicture, {
                folder: '/profile-pictures',
                fileName: `profile_${employee._id}_${Date.now()}.${format}`,
                tags: ['profile', 'migrated', 'employee'],
                customMetadata: {
                    employeeId: employee._id.toString(),
                    migratedAt: new Date().toISOString(),
                },
            });

            // Update database
            await Employee.updateOne(
                { _id: employee._id },
                {
                    $set: {
                        profilePicture: result.url,
                        profilePictureFileId: result.fileId,
                    }
                }
            );

            console.log(`    ✓ Migrated to: ${result.url}`);
            migrated++;
        } catch (error) {
            console.error(`    ✗ Error: ${error.message}`);
            errors++;
        }
    }

    return { processed: employees.length, migrated, errors };
}

/**
 * Migrate User avatars
 */
async function migrateUserAvatars() {
    if (specificModel && specificModel !== 'User') return { processed: 0, migrated: 0, errors: 0 };

    console.log('\n👤 Migrating User Avatars...');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

    const users = await User.find({
        avatar: { $regex: '^data:image/' }
    }).limit(limit).lean();

    console.log(`Found ${users.length} users with base64 avatars`);

    let migrated = 0;
    let errors = 0;

    for (const user of users) {
        try {
            console.log(`  Processing: ${user.email}`);

            if (!isBase64Image(user.avatar)) {
                console.log(`    Skipped: Not a valid base64 image`);
                continue;
            }

            if (isDryRun) {
                console.log(`    [DRY RUN] Would upload to ImageKit`);
                migrated++;
                continue;
            }

            const format = getImageFormat(user.avatar);
            const result = await uploadImageToImageKit(user.avatar, {
                folder: '/avatars',
                fileName: `avatar_${user._id}_${Date.now()}.${format}`,
                tags: ['avatar', 'migrated', 'user'],
                customMetadata: {
                    userId: user._id.toString(),
                    migratedAt: new Date().toISOString(),
                },
            });

            await User.updateOne(
                { _id: user._id },
                {
                    $set: {
                        avatar: result.url,
                        avatarFileId: result.fileId,
                    }
                }
            );

            console.log(`    ✓ Migrated to: ${result.url}`);
            migrated++;
        } catch (error) {
            console.error(`    ✗ Error: ${error.message}`);
            errors++;
        }
    }

    return { processed: users.length, migrated, errors };
}

/**
 * Migrate Aadhaar uploads
 */
async function migrateAadhaarUploads() {
    if (specificModel && specificModel !== 'User') return { processed: 0, migrated: 0, errors: 0 };

    console.log('\n🪪 Migrating Aadhaar Uploads...');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

    const users = await User.find({
        $or: [
            { 'profileCompletion.aadhaarFront.url': { $regex: '^data:image/' } },
            { 'profileCompletion.aadhaarBack.url': { $regex: '^data:image/' } }
        ]
    }).limit(limit).lean();

    console.log(`Found ${users.length} users with base64 Aadhaar images`);

    let migrated = 0;
    let errors = 0;

    for (const user of users) {
        try {
            console.log(`  Processing: ${user.email}`);
            const updates = {};

            // Migrate front
            if (isBase64Image(user.profileCompletion?.aadhaarFront?.url)) {
                if (isDryRun) {
                    console.log(`    [DRY RUN] Would upload Aadhaar front to ImageKit`);
                } else {
                    const format = getImageFormat(user.profileCompletion.aadhaarFront.url);
                    const result = await uploadImageToImageKit(user.profileCompletion.aadhaarFront.url, {
                        folder: `/aadhaar/${user._id}`,
                        fileName: `aadhaar_front_${Date.now()}.${format}`,
                        tags: ['aadhaar', 'front', 'document', 'migrated'],
                        customMetadata: {
                            userId: user._id.toString(),
                            documentType: 'aadhaar',
                            side: 'front',
                        },
                    });
                    updates['profileCompletion.aadhaarFront.url'] = result.url;
                    updates['profileCompletion.aadhaarFront.fileId'] = result.fileId;
                    console.log(`    ✓ Front migrated to: ${result.url}`);
                }
                migrated++;
            }

            // Migrate back
            if (isBase64Image(user.profileCompletion?.aadhaarBack?.url)) {
                if (isDryRun) {
                    console.log(`    [DRY RUN] Would upload Aadhaar back to ImageKit`);
                } else {
                    const format = getImageFormat(user.profileCompletion.aadhaarBack.url);
                    const result = await uploadImageToImageKit(user.profileCompletion.aadhaarBack.url, {
                        folder: `/aadhaar/${user._id}`,
                        fileName: `aadhaar_back_${Date.now()}.${format}`,
                        tags: ['aadhaar', 'back', 'document', 'migrated'],
                        customMetadata: {
                            userId: user._id.toString(),
                            documentType: 'aadhaar',
                            side: 'back',
                        },
                    });
                    updates['profileCompletion.aadhaarBack.url'] = result.url;
                    updates['profileCompletion.aadhaarBack.fileId'] = result.fileId;
                    console.log(`    ✓ Back migrated to: ${result.url}`);
                }
                migrated++;
            }

            if (!isDryRun && Object.keys(updates).length > 0) {
                await User.updateOne({ _id: user._id }, { $set: updates });
            }
        } catch (error) {
            console.error(`    ✗ Error: ${error.message}`);
            errors++;
        }
    }

    return { processed: users.length, migrated, errors };
}

/**
 * Main migration function
 */
async function main() {
    try {
        // Connect to MongoDB
        console.log('\nConnecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected successfully!\n');

        const results = {
            employeeProfiles: await migrateEmployeeProfilePictures(),
            userAvatars: await migrateUserAvatars(),
            aadhaarUploads: await migrateAadhaarUploads(),
            whiteboardThumbnails: await migrateWhiteboardThumbnails(),
        };

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('MIGRATION SUMMARY');
        console.log('='.repeat(60));

        let totalProcessed = 0;
        let totalMigrated = 0;
        let totalErrors = 0;

        for (const [name, result] of Object.entries(results)) {
            console.log(`\n${name}:`);
            console.log(`  Processed: ${result.processed}`);
            console.log(`  Migrated:  ${result.migrated}`);
            console.log(`  Errors:    ${result.errors}`);
            totalProcessed += result.processed;
            totalMigrated += result.migrated;
            totalErrors += result.errors;
        }

        console.log('\n' + '-'.repeat(60));
        console.log(`TOTAL: ${totalProcessed} processed, ${totalMigrated} migrated, ${totalErrors} errors`);

        if (isDryRun) {
            console.log('\n⚠️  This was a DRY RUN. No changes were made.');
            console.log('   Run without --dry-run to apply changes.');
        }

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

/**
 * Migrate Whiteboard thumbnails
 */
async function migrateWhiteboardThumbnails() {
    if (specificModel && specificModel !== 'Whiteboard') return { processed: 0, migrated: 0, errors: 0 };

    console.log('\n🎨 Migrating Whiteboard Thumbnails...');

    const Whiteboard = mongoose.model('Whiteboard', new mongoose.Schema({}, { strict: false }));

    const whiteboards = await Whiteboard.find({
        thumbnail: { $regex: '^data:image/' }
    }).limit(limit).lean();

    console.log(`Found ${whiteboards.length} whiteboards with base64 thumbnails`);

    let migrated = 0;
    let errors = 0;

    for (const whiteboard of whiteboards) {
        try {
            console.log(`  Processing: ${whiteboard.title} (${whiteboard._id})`);

            if (!isBase64Image(whiteboard.thumbnail)) {
                console.log(`    Skipped: Not a valid base64 image`);
                continue;
            }

            if (isDryRun) {
                console.log(`    [DRY RUN] Would upload to ImageKit`);
                migrated++;
                continue;
            }

            const format = getImageFormat(whiteboard.thumbnail);
            const result = await uploadImageToImageKit(whiteboard.thumbnail, {
                folder: '/whiteboards/thumbnails',
                fileName: `whiteboard_${whiteboard._id}_${Date.now()}.${format}`,
                tags: ['whiteboard', 'thumbnail', 'migrated'],
                customMetadata: {
                    whiteboardId: whiteboard._id.toString(),
                    migratedAt: new Date().toISOString(),
                },
            });

            await Whiteboard.updateOne(
                { _id: whiteboard._id },
                {
                    $set: {
                        thumbnail: result.url,
                        thumbnailFileId: result.fileId,
                    }
                }
            );

            console.log(`    ✓ Migrated to: ${result.url}`);
            migrated++;
        } catch (error) {
            console.error(`    ✗ Error: ${error.message}`);
            errors++;
        }
    }

    return { processed: whiteboards.length, migrated, errors };
}

main();
