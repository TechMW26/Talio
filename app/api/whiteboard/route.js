import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getWhiteboardContext, listVisibleWhiteboards, populateWhiteboard, boardError } from '@/lib/whiteboards.server'

export async function GET(request) {
  try {
    const context = await getWhiteboardContext(request)
    const params = new URL(request.url).searchParams
    const search = (params.get('search') || '').trim().toLowerCase()
    const page = Math.max(1, Number(params.get('page')) || 1)
    const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 20))
    const records = (await listVisibleWhiteboards(context)).filter(board => !search || [board.title, board.name, board.description].some(value => String(value || '').toLowerCase().includes(search)))
    records.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    const boards = await Promise.all(records.slice((page - 1) * limit, page * limit).map(board => populateWhiteboard(context, board, { summary: true })))
    return NextResponse.json({ boards, pagination: { page, limit, total: records.length, pages: Math.ceil(records.length / limit) } })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to fetch whiteboards' }, { status: error.status || 500 })
  }
}

export async function POST(request) {
  const startedAt = performance.now()
  try {
    const context = await getWhiteboardContext(request)
    if (!context.employeeId) throw boardError('Employee not found', 404)
    const body = await request.json()
    const title = body.title || body.name || 'Untitled Board'
    if (typeof title !== 'string' || title.length > 300 || (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 10000))) throw boardError('Invalid board title or description')
    const whiteboard = {
      _id: randomBytes(12).toString('hex'), title, name: title, description: body.description || '',
      owner: context.userId, createdBy: context.employeeId, data: null, isPublic: false, sharedWith: [], sharing: [],
      pages: [{ id: 'page-1', objects: [] }], currentPageIndex: 0, theme: 'white', showGrid: false,
      defaultZoom: 1, defaultPanX: 0, defaultPanY: 0, aiAnalysis: { summary: '', messages: [], notes: [], keyPoints: [] },
      lastModified: new Date(), createdAt: new Date(), updatedAt: new Date(),
    }
    await context.store.create('whiteboards', whiteboard)
    return NextResponse.json({ success: true, whiteboard, permission: 'owner' }, { status: 201, headers: { 'Server-Timing': `board-create;dur=${(performance.now() - startedAt).toFixed(1)}` } })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to create whiteboard' }, { status: error.status || 500 })
  }
}
