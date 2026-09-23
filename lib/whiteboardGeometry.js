const PATH_TYPES = new Set(['pencil', 'highlighter', 'line', 'arrow', 'curvedArrow', 'dottedArrow', 'pigtailArrow', 'connector']);

export function moveWhiteboardObject(object, dx, dy) {
  const movePoint = point => ({ ...point, x: (Number(point.x) || 0) + dx, y: (Number(point.y) || 0) + dy });
  if (PATH_TYPES.has(object.type) && object.points?.length) {
    return {
      ...object,
      points: object.points.map(movePoint),
      ...(object.controlPoint ? { controlPoint: movePoint(object.controlPoint) } : {}),
    };
  }
  // Mongoose defaults points to [] even for text, shapes and images.
  return { ...object, x: (Number(object.x) || 0) + dx, y: (Number(object.y) || 0) + dy };
}
