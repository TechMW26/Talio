// Only transparent canvas padding may cross an edge; the visible face remains reachable.
export const MIRA_FACE_PADDING = 40
export function miraFloatingSize(hasDetails, viewport = {}) {
  return {
    width: Math.min(hasDetails ? 360 : 224, viewport.width || 360),
    height: Math.min(hasDetails ? 444 : 224, (viewport.height || 444) + MIRA_FACE_PADDING),
  }
}
export function clampMiraFloating(point, size, viewport, hasDetails) {
  const side = hasDetails ? 0 : MIRA_FACE_PADDING
  return {
    x: Math.max(0 - side, Math.min(viewport.width - size.width + side, point.x)),
    y: Math.max(hasDetails ? 0 : -MIRA_FACE_PADDING, Math.min(viewport.height - size.height + MIRA_FACE_PADDING, point.y)),
  }
}

// Voice transcripts are not display requests. Tool cards/images and typed replies are.
export function miraFloatingResult(message, voiceActive) {
  if (!message || message.role !== 'assistant' || message.streaming) return null
  const data = message.data || {}
  const visual = Boolean(data.cards?.length || data.image || data.gallery || data.actionResult?.resolution?.candidates?.length)
  if ((voiceActive || data.nativeVoice) && !visual) return null
  if (!visual && !(data.message || message.content)?.trim()) return null
  return message
}
