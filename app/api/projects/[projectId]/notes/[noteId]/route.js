import { changeProjectNote } from '@/lib/projectCollaboration.server'
export const PUT = changeProjectNote(false)
export const DELETE = changeProjectNote(true)
