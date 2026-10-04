import { createHash } from 'node:crypto'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { processImage } from '@/lib/imagePipeline'
import { boardError } from '@/lib/whiteboards.server'

// Autosaves may resend original browser data URLs. Reuse already-committed
// content hashes so saving unchanged canvas images doesn't upload them again.
export async function storeWhiteboardImages(context, pages, previousPages, uploaded = []) {
  const existing = new Map((previousPages || []).flatMap(page => page.objects || []).filter(object => object.imageSourceSha256 && object.image && !object.image.startsWith('data:')).map(object => [object.imageSourceSha256, object]))
  const result = []
  for (const page of pages) {
    const objects = []
    for (const object of page.objects) {
      if (typeof object.image !== 'string' || !object.image.startsWith('data:')) { objects.push(object); continue }
      if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(object.image)) throw boardError('Unsupported canvas image')
      const bytes = Buffer.from(object.image.split(',')[1], 'base64')
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw boardError('Canvas image must be at most 10 MB')
      const imageSourceSha256 = createHash('sha256').update(bytes).digest('hex')
      let media = existing.get(imageSourceSha256)
      if (!media) {
        const processed = await processImage(bytes, { type: 'attachment' })
        const stored = await uploadImage(processed.buffer, { databaseName: context.databaseName, category: 'whiteboard', userId: context.userId, originalName: `canvas-${imageSourceSha256}.${processed.format}`, contentType: processed.mimeType })
        uploaded.push(stored._id)
        media = { image: stored.url, imageFileId: String(stored._id), imageSourceSha256 }
        existing.set(imageSourceSha256, media)
      }
      objects.push({ ...object, image: media.image, imageFileId: media.imageFileId, imageSourceSha256 })
    }
    result.push({ ...page, objects })
  }
  return result
}
export async function rollbackWhiteboardImages(context, fileIds) {
  await Promise.all(fileIds.map(fileId => deleteImage(fileId, { databaseName: context.databaseName }).catch(() => {})))
}
