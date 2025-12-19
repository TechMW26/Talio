import mongoose from 'mongoose';
import { Readable } from 'stream';
import connectDB from './mongodb.js';

let gridFSBucket = null;

/**
 * Initialize GridFS bucket for screenshot storage
 */
async function getGridFSBucket() {
  if (gridFSBucket) {
    return gridFSBucket;
  }

  await connectDB();
  
  // Get the native MongoDB connection
  const db = mongoose.connection.db;
  
  // Create GridFS bucket with 'screenshots' collection prefix
  gridFSBucket = new mongoose.mongo.GridFSBucket(db, {
    bucketName: 'screenshots'
  });
  
  console.log('[GridFS] Bucket initialized');
  return gridFSBucket;
}

/**
 * Upload a screenshot to GridFS
 * @param {Buffer} imageBuffer - The image data as a buffer
 * @param {Object} metadata - Metadata to store with the file
 * @returns {Promise<Object>} - The uploaded file info with _id
 */
export async function uploadScreenshot(imageBuffer, metadata = {}) {
  const bucket = await getGridFSBucket();
  
  const filename = `screenshot_${metadata.userId || 'unknown'}_${Date.now()}.${metadata.format || 'png'}`;
  
  return new Promise((resolve, reject) => {
    // Create readable stream from buffer
    const readableStream = new Readable();
    readableStream.push(imageBuffer);
    readableStream.push(null);
    
    // Create upload stream
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: metadata.mimeType || 'image/png',
      metadata: {
        userId: metadata.userId,
        employeeId: metadata.employeeId,
        capturedAt: metadata.capturedAt || new Date(),
        sessionId: metadata.sessionId,
        activity: metadata.activity || {},
        width: metadata.width,
        height: metadata.height
      }
    });
    
    // Handle events
    uploadStream.on('error', (error) => {
      console.error('[GridFS] Upload error:', error);
      reject(error);
    });
    
    uploadStream.on('finish', () => {
      console.log(`[GridFS] Uploaded: ${filename} (${uploadStream.id})`);
      resolve({
        _id: uploadStream.id,
        filename: filename,
        length: imageBuffer.length,
        contentType: metadata.mimeType || 'image/png'
      });
    });
    
    // Pipe the data
    readableStream.pipe(uploadStream);
  });
}

/**
 * Get a screenshot from GridFS by file ID
 * @param {ObjectId|string} fileId - The GridFS file ID
 * @returns {Promise<Buffer>} - The image data as a buffer
 */
export async function getScreenshot(fileId) {
  const bucket = await getGridFSBucket();
  
  const objectId = typeof fileId === 'string' 
    ? new mongoose.Types.ObjectId(fileId) 
    : fileId;
  
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    const downloadStream = bucket.openDownloadStream(objectId);
    
    downloadStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    downloadStream.on('error', (error) => {
      console.error('[GridFS] Download error:', error);
      reject(error);
    });
    
    downloadStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });
  });
}

/**
 * Get screenshot as a readable stream (for piping to response)
 * @param {ObjectId|string} fileId - The GridFS file ID
 * @returns {ReadableStream} - The image data stream
 */
export async function getScreenshotStream(fileId) {
  const bucket = await getGridFSBucket();
  
  const objectId = typeof fileId === 'string' 
    ? new mongoose.Types.ObjectId(fileId) 
    : fileId;
  
  return bucket.openDownloadStream(objectId);
}

/**
 * Get file info from GridFS
 * @param {ObjectId|string} fileId - The GridFS file ID
 * @returns {Promise<Object|null>} - File info or null if not found
 */
export async function getScreenshotInfo(fileId) {
  const bucket = await getGridFSBucket();
  
  const objectId = typeof fileId === 'string' 
    ? new mongoose.Types.ObjectId(fileId) 
    : fileId;
  
  const files = await bucket.find({ _id: objectId }).toArray();
  return files.length > 0 ? files[0] : null;
}

/**
 * Delete a screenshot from GridFS
 * @param {ObjectId|string} fileId - The GridFS file ID
 * @returns {Promise<boolean>} - True if deleted successfully
 */
export async function deleteScreenshot(fileId) {
  const bucket = await getGridFSBucket();
  
  const objectId = typeof fileId === 'string' 
    ? new mongoose.Types.ObjectId(fileId) 
    : fileId;
  
  try {
    await bucket.delete(objectId);
    console.log(`[GridFS] Deleted: ${fileId}`);
    return true;
  } catch (error) {
    console.error('[GridFS] Delete error:', error);
    return false;
  }
}

/**
 * Delete multiple screenshots from GridFS
 * @param {Array<ObjectId|string>} fileIds - Array of GridFS file IDs
 * @returns {Promise<Object>} - Result with success count and errors
 */
export async function deleteScreenshots(fileIds) {
  const bucket = await getGridFSBucket();
  
  let successCount = 0;
  const errors = [];
  
  for (const fileId of fileIds) {
    try {
      const objectId = typeof fileId === 'string' 
        ? new mongoose.Types.ObjectId(fileId) 
        : fileId;
      
      await bucket.delete(objectId);
      successCount++;
    } catch (error) {
      errors.push({ fileId, error: error.message });
    }
  }
  
  console.log(`[GridFS] Bulk delete: ${successCount}/${fileIds.length} succeeded`);
  return { successCount, errorCount: errors.length, errors };
}

/**
 * Delete all screenshots older than a certain date
 * @param {Date} olderThan - Delete files older than this date
 * @returns {Promise<Object>} - Result with deleted count
 */
export async function deleteOldScreenshots(olderThan) {
  const bucket = await getGridFSBucket();
  
  // Find all files older than the specified date
  const files = await bucket.find({
    uploadDate: { $lt: olderThan }
  }).toArray();
  
  console.log(`[GridFS] Found ${files.length} files older than ${olderThan.toISOString()}`);
  
  if (files.length === 0) {
    return { deletedCount: 0 };
  }
  
  const fileIds = files.map(f => f._id);
  const result = await deleteScreenshots(fileIds);
  
  return {
    deletedCount: result.successCount,
    errorCount: result.errorCount,
    errors: result.errors
  };
}

/**
 * Get storage statistics
 * @returns {Promise<Object>} - Storage stats
 */
export async function getStorageStats() {
  await connectDB();
  const db = mongoose.connection.db;
  
  // Get files collection stats
  const filesCollection = db.collection('screenshots.files');
  const chunksCollection = db.collection('screenshots.chunks');
  
  const fileCount = await filesCollection.countDocuments();
  const chunksStats = await chunksCollection.aggregate([
    { $group: { _id: null, totalSize: { $sum: '$length' } } }
  ]).toArray();
  
  const totalSize = chunksStats.length > 0 ? chunksStats[0].totalSize : 0;
  
  return {
    fileCount,
    totalSizeBytes: totalSize,
    totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100
  };
}

export default {
  uploadScreenshot,
  getScreenshot,
  getScreenshotStream,
  getScreenshotInfo,
  deleteScreenshot,
  deleteScreenshots,
  deleteOldScreenshots,
  getStorageStats
};
