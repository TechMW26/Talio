export function getMeetingGrid(width, height, count, gap = 12) {
  if (width <= 0 || height <= 0 || count < 1) return { columns: 1, tileWidth: Math.max(0, width) }
  let best = { columns: 1, tileWidth: 0 }
  const maxColumns = Math.min(count, Math.max(1, Math.floor((width + gap) / (180 + gap))))
  for (let columns = 1; columns <= maxColumns; columns++) {
    const rows = Math.ceil(count / columns)
    const tileWidth = Math.min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) / rows * 16 / 9, 1280)
    if (tileWidth > best.tileWidth) best = { columns, tileWidth }
  }
  // Large calls scroll rather than shrinking controls below a usable size.
  if (best.tileWidth < Math.min(180, width)) return { columns: maxColumns, tileWidth: (width - gap * (maxColumns - 1)) / maxColumns }
  return best
}
