import sharp from 'sharp'

// Image optimization configurations
const OPTIMIZATION_CONFIG = {
  // Maximum dimensions for different use cases
  maxDimensions: {
    avatar: { width: 256, height: 256 },
    thumbnail: { width: 300, height: 300 },
    medium: { width: 800, height: 800 },
    large: { width: 1920, height: 1920 },
    screenshot: { width: 1920, height: 1080 }
  },
  // Quality settings (lower = smaller file, less quality)
  quality: {
    high: 85,
    medium: 75,
    low: 60,
    thumbnail: 70
  },
  // Supported formats
  supportedFormats: ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif']
}

/**
 * Optimize an image buffer for storage and fast loading
 * @param {Buffer} buffer - The image buffer to optimize
 * @param {Object} options - Optimization options
 * @param {string} options.type - Type of image: 'avatar', 'thumbnail', 'medium', 'large', 'screenshot'
 * @param {string} options.format - Output format: 'webp', 'jpeg', 'png', 'avif'
 * @param {number} options.quality - Quality 1-100 (optional, uses preset based on type)
 * @returns {Promise<{buffer: Buffer, metadata: Object}>}
 */
export async function optimizeImage(buffer, options = {}) {
  const {
    type = 'medium',
    format = 'webp',
    quality = null,
    preserveExif = false
  } = options

  try {
    const dimensions = OPTIMIZATION_CONFIG.maxDimensions[type] || OPTIMIZATION_CONFIG.maxDimensions.medium
    const outputQuality = quality || OPTIMIZATION_CONFIG.quality[type === 'thumbnail' ? 'thumbnail' : 'medium']

    let pipeline = sharp(buffer, { 
      failOnError: false,
      animated: format === 'webp' || format === 'gif' // Preserve animation for webp/gif
    })

    // Get original metadata
    const metadata = await pipeline.metadata()

    // Resize if larger than max dimensions (maintain aspect ratio)
    if (metadata.width > dimensions.width || metadata.height > dimensions.height) {
      pipeline = pipeline.resize(dimensions.width, dimensions.height, {
        fit: 'inside',
        withoutEnlargement: true
      })
    }

    // Remove EXIF data unless explicitly preserved (reduces file size and privacy)
    if (!preserveExif) {
      pipeline = pipeline.rotate() // Auto-rotate based on EXIF, then strip
    }

    // Convert to optimized format
    switch (format) {
      case 'webp':
        pipeline = pipeline.webp({ 
          quality: outputQuality,
          effort: 4, // Balance between speed and compression (0-6)
          smartSubsample: true
        })
        break
      case 'avif':
        pipeline = pipeline.avif({ 
          quality: outputQuality,
          effort: 4
        })
        break
      case 'jpeg':
      case 'jpg':
        pipeline = pipeline.jpeg({ 
          quality: outputQuality,
          mozjpeg: true, // Use mozjpeg for better compression
          progressive: true
        })
        break
      case 'png':
        pipeline = pipeline.png({ 
          quality: outputQuality,
          compressionLevel: 8,
          progressive: true
        })
        break
      default:
        pipeline = pipeline.webp({ quality: outputQuality })
    }

    const optimizedBuffer = await pipeline.toBuffer()
    const newMetadata = await sharp(optimizedBuffer).metadata()

    return {
      buffer: optimizedBuffer,
      metadata: {
        originalSize: buffer.length,
        optimizedSize: optimizedBuffer.length,
        compressionRatio: ((1 - optimizedBuffer.length / buffer.length) * 100).toFixed(1),
        width: newMetadata.width,
        height: newMetadata.height,
        format: newMetadata.format
      }
    }
  } catch (error) {
    console.error('Image optimization error:', error)
    // Return original buffer if optimization fails
    return {
      buffer,
      metadata: { error: error.message, originalSize: buffer.length }
    }
  }
}

/**
 * Create a thumbnail from an image buffer
 * @param {Buffer} buffer - The image buffer
 * @param {number} size - Thumbnail size (square)
 * @returns {Promise<Buffer>}
 */
export async function createThumbnail(buffer, size = 200) {
  try {
    return await sharp(buffer, { failOnError: false })
      .resize(size, size, {
        fit: 'cover',
        position: 'centre'
      })
      .webp({ quality: 70 })
      .toBuffer()
  } catch (error) {
    console.error('Thumbnail creation error:', error)
    return buffer
  }
}

/**
 * Get image metadata without fully loading the image
 * @param {Buffer} buffer - The image buffer
 * @returns {Promise<Object>}
 */
export async function getImageMetadata(buffer) {
  try {
    return await sharp(buffer).metadata()
  } catch (error) {
    console.error('Metadata extraction error:', error)
    return null
  }
}

/**
 * Check if a file is a valid image
 * @param {Buffer} buffer - The file buffer
 * @returns {Promise<boolean>}
 */
export async function isValidImage(buffer) {
  try {
    const metadata = await sharp(buffer).metadata()
    return OPTIMIZATION_CONFIG.supportedFormats.includes(metadata.format)
  } catch {
    return false
  }
}

/**
 * Optimize avatar image with circular crop preparation
 * @param {Buffer} buffer - The image buffer
 * @returns {Promise<Buffer>}
 */
export async function optimizeAvatar(buffer) {
  const { buffer: optimized } = await optimizeImage(buffer, {
    type: 'avatar',
    format: 'webp',
    quality: 80
  })
  return optimized
}

/**
 * Optimize screenshot for productivity monitoring
 * @param {Buffer} buffer - The screenshot buffer
 * @returns {Promise<Buffer>}
 */
export async function optimizeScreenshot(buffer) {
  const { buffer: optimized } = await optimizeImage(buffer, {
    type: 'screenshot',
    format: 'webp',
    quality: 60 // Lower quality for screenshots (smaller files)
  })
  return optimized
}

export default {
  optimizeImage,
  createThumbnail,
  getImageMetadata,
  isValidImage,
  optimizeAvatar,
  optimizeScreenshot
}
