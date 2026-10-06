import { NextResponse } from 'next/server'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { processImage } from '@/lib/imagePipeline'
import { storeWhiteboardImages, rollbackWhiteboardImages } from '@/lib/whiteboardMedia.server'
import { getWhiteboardContext, assertWhiteboardAccess, populateWhiteboard, mutateWhiteboard, validateWhiteboardShares, boardError } from '@/lib/whiteboards.server'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const context = await getWhiteboardContext(request)
    const board = await context.store.get('whiteboards', id)
    const permission = assertWhiteboardAccess(board, context)
    return NextResponse.json({ whiteboard: await populateWhiteboard(context, board), permission })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to fetch whiteboard' }, { status: error.status || 500 })
  }
}

export async function PUT(request, { params }) {
  let context, uploaded, committed = false
  const canvasUploads = []
  try {
    const { id } = await params
    context = await getWhiteboardContext(request)
    const initial = await context.store.get('whiteboards', id)
    assertWhiteboardAccess(initial, context, 'editor')
    const body = await request.json()
    const changes = {}
    if (body.pages !== undefined) {
      if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > 100 || body.pages.some(page => !page?.id || !Array.isArray(page.objects) || page.objects.length > 10000)) throw boardError('Invalid canvas pages')
      changes.pages = await storeWhiteboardImages(context, body.pages, initial.pages, canvasUploads)
    }
    if (body.theme !== undefined) {
      if (!['white', 'black', 'chalk'].includes(body.theme)) throw boardError('Invalid theme')
      changes.theme = body.theme
    }
    for (const key of ['description', 'name', 'title']) if (body[key] !== undefined) {
      if (typeof body[key] !== 'string' || body[key].length > (key === 'description' ? 10000 : 300)) throw boardError(`Invalid ${key}`)
      changes[key] = body[key]
    }
    if (body.title !== undefined || body.name !== undefined) changes.name = changes.title = body.title ?? body.name
    for (const key of ['data', 'aiAnalysis']) if (body[key] !== undefined) changes[key] = body[key]
    if (body.showGrid !== undefined) changes.showGrid = Boolean(body.showGrid)
    const changesSharing = body.sharedWith !== undefined || body.isPublic !== undefined
    if (changesSharing) {
      assertWhiteboardAccess(initial, context, 'owner')
      if (body.sharedWith !== undefined) changes.sharedWith = await validateWhiteboardShares(context, body.sharedWith)
      if (body.isPublic !== undefined) {
        if (typeof body.isPublic !== 'boolean') throw boardError('Invalid public setting')
        changes.isPublic = body.isPublic
      }
    }
    if (body.thumbnail !== undefined) {
      if (typeof body.thumbnail !== 'string') throw boardError('Invalid thumbnail')
      if (body.thumbnail.startsWith('data:')) {
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(body.thumbnail)) throw boardError('Invalid thumbnail image')
        const bytes = Buffer.from(body.thumbnail.split(',')[1], 'base64')
        if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw boardError('Thumbnail must be at most 2 MB')
        const image = await processImage(bytes, { type: 'thumbnail' })
        uploaded = await uploadImage(image.buffer, { databaseName: context.databaseName, category: 'whiteboard', contentType: image.mimeType, originalName: `whiteboard-${id}.${image.format}`, userId: context.userId })
        changes.thumbnail = uploaded.url; changes.thumbnailFileId = String(uploaded._id)
      } else if (body.thumbnail === '') {
        changes.thumbnail = ''; changes.thumbnailFileId = ''
      } else if (body.thumbnail !== initial.thumbnail) throw boardError('Upload a thumbnail image instead of a storage URL')
    }
    let previousThumbnail
    const board = await mutateWhiteboard(context, id, current => {
      previousThumbnail = current.thumbnailFileId
      return { ...current, ...changes }
    }, { required: changesSharing ? 'owner' : 'editor', expectedUpdatedAt: body.updatedAt ?? initial.updatedAt ?? null })
    committed = true
    if ('thumbnail' in changes && previousThumbnail && previousThumbnail !== board.thumbnailFileId) await deleteImage(previousThumbnail, { databaseName: context.databaseName }).catch(() => {})
    if (global.io) global.io.to(`whiteboard:${context.databaseName}:${id}`).emit('whiteboard:updated', { whiteboardId: id, updatedBy: context.userId, timestamp: Date.now() })
    return NextResponse.json({ success: true, whiteboard: { _id: board._id, title: board.title, lastModified: board.lastModified, updatedAt: board.updatedAt } })
  } catch (error) {
    if (!committed && canvasUploads.length) await rollbackWhiteboardImages(context, canvasUploads)
    if (uploaded && !committed) await deleteImage(uploaded._id, { databaseName: context.databaseName }).catch(() => {})
    return NextResponse.json({ error: error.status ? error.message : 'Failed to update whiteboard' }, { status: error.status || 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const context = await getWhiteboardContext(request)
    const previous = await context.store.transaction(async tx => {
      const board = await tx.get('whiteboards', id)
      assertWhiteboardAccess(board, context, 'owner')
      await tx.delete('whiteboards', id)
      return board
    })
    if (previous.thumbnailFileId) await deleteImage(previous.thumbnailFileId, { databaseName: context.databaseName }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to delete whiteboard' }, { status: error.status || 500 })
  }
}
