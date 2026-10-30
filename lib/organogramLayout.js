export const ORGANOGRAM_GEOMETRY = { NW: 214, NH: 164, H_GAP: 20, ROW_GAP: 68, BAND_GAP: 96, AVATAR_H: 36, PAD_X: 42 }
export const ORGANOGRAM_BAND_ORDER = [9, 8, 7, 'HR', 6, 5, 4, 3, 2, 1]
const { NW, NH, H_GAP, ROW_GAP, BAND_GAP, AVATAR_H, PAD_X } = ORGANOGRAM_GEOMETRY
const BAND_ORDER = ORGANOGRAM_BAND_ORDER

export function isHrNode(node) {
  if (node?.isHR) return true;
  const dept = (node?.department || '').toString().trim().toLowerCase();
  const desig = (node?.designation || '').toString().trim().toLowerCase();
  const re = /(human\s*resource|people\s*operations|people\s*&?\s*culture|talent\s*management|^hr$|\bhr\b|hrbp|hr\s*ops)/;
  return re.test(dept) || re.test(desig);
}

export function organogramCanvasWidth(roots, viewportWidth = 0) {
  // Rank determines the band; a narrow viewport must not visually demote a
  // newly promoted director into a second row. Lower bands can still wrap.
  let directors = 0
  const pending = [...(roots || [])]
  while (pending.length) {
    const node = pending.pop()
    if (Number(node.level) === 9 && !isHrNode(node)) directors++
    pending.push(...(node.children || []))
  }
  const directorRowWidth = directors * NW + Math.max(0, directors - 1) * H_GAP + PAD_X * 2
  return Math.max(Number(viewportWidth) || 0, 1200, directorRowWidth)
}

function parseDateSafe(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function fitOrganogramWidth(canvasWidth, viewportWidth, leftInset = 0, rightInset = 0) {
  const availableWidth = Math.max(1, viewportWidth - leftInset - rightInset)
  const scale = Math.min(0.8, availableWidth / (canvasWidth + 10))
  return { scale, tx: leftInset + (availableWidth - canvasWidth * scale) / 2 }
}

function compareByTenureThenAge(a, b) {
  const joinA = parseDateSafe(a.dateOfJoining);
  const joinB = parseDateSafe(b.dateOfJoining);
  if (joinA !== null && joinB !== null && joinA !== joinB) return joinA - joinB;
  if (joinA !== null && joinB === null) return -1;
  if (joinA === null && joinB !== null) return 1;

  const dobA = parseDateSafe(a.dateOfBirth);
  const dobB = parseDateSafe(b.dateOfBirth);
  if (dobA !== null && dobB !== null && dobA !== dobB) return dobA - dobB;
  if (dobA !== null && dobB === null) return -1;
  if (dobA === null && dobB !== null) return 1;

  return (a.name || '').localeCompare(b.name || '');
}

export function buildLayout(allNodes, canvasW) {
  const maxCols = Math.max(3, Math.floor((canvasW - PAD_X * 2 + H_GAP) / (NW + H_GAP)));

  const byLevel = {};
  for (const key of BAND_ORDER) byLevel[key] = [];
  for (const n of allNodes) {
    if (isHrNode(n)) {
      byLevel.HR.push(n);
      continue;
    }
    const lvl = Math.min(Math.max(Number(n.level) || 1, 1), 9);
    byLevel[lvl].push(n);
  }
  for (const key of BAND_ORDER) byLevel[key].sort(compareByTenureThenAge);

  const bandInfo = {};
  let currentY = AVATAR_H + 8;

  // Bands that should always render a divider/label even when empty
  const ALWAYS_SHOW = new Set(['HR', 6, 5, 4]);
  const EMPTY_BAND_H = 28;

  for (const lvl of BAND_ORDER) {
    const group = byLevel[lvl];
    if (!group.length) {
      if (!ALWAYS_SHOW.has(lvl)) continue;
      const bandStartY = currentY;
      bandInfo[lvl] = { startY: bandStartY, endY: bandStartY + EMPTY_BAND_H, count: 0 };
      currentY += EMPTY_BAND_H + BAND_GAP;
      continue;
    }

    const bandStartY = currentY;
    const numRows = Math.ceil(group.length / maxCols);

    for (let i = 0; i < group.length; i++) {
      const rowIdx = Math.floor(i / maxCols);
      const colIdx = i % maxCols;

      const rowStart = rowIdx * maxCols;
      const rowCount = Math.min(maxCols, group.length - rowStart);
      const rowW = rowCount * NW + (rowCount - 1) * H_GAP;
      const startX = (canvasW - rowW) / 2;

      group[i]._x = startX + colIdx * (NW + H_GAP) + NW / 2;
      group[i]._y = currentY + rowIdx * (NH + ROW_GAP);
    }

    const bandH = numRows * NH + (numRows - 1) * ROW_GAP;
    bandInfo[lvl] = { startY: bandStartY, endY: bandStartY + bandH, count: group.length };
    currentY += bandH + BAND_GAP;
  }

  return { bandInfo, canvasH: currentY + 20 };
}


