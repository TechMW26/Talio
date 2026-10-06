/**
 * Screenshot Composite Builder
 * --------------------------------
 * After AI analysis succeeds for a batch of pending screenshots we stitch
 * them into ONE big mosaic image (per user, per day), store it in GridFS,
 * record per-tile rectangles in the `ScreenshotComposite` doc, and delete
 * the individual `Screenshot` rows + their GridFS files. Subsequent batches
 * append: we re-stitch the previous mosaic with the new screenshots so the
 * single composite grows monotonically while the per-screenshot DB+blob
 * footprint stays at zero.
 *
 * Layout:
 *   - Fixed tile dimensions so existing rectangles remain accurate when
 *     appending. Each new batch only adds new rows.
 *   - Tiles are arranged left-to-right, top-to-bottom in a fixed-column grid.
 *   - Tiles are normalized to a compressed, analysis-friendly format to keep
 *     payload size low while preserving readability.
 */

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { getScreenshotStore, findScreenshotComposite } from '@/lib/platform/firestoreScreenshots.server';
import {
  uploadScreenshot,
  getScreenshot,
  deleteScreenshots,
} from '@/lib/mediaStorage';
import { loadScreenshotForAnalysis } from '@/lib/productivityScreenshotLoader';

const COMPOSITE_TILE_WIDTH = parseInt(process.env.PRODUCTIVITY_COMPOSITE_TILE_WIDTH || '960', 10) || 960;
const COMPOSITE_TILE_HEIGHT = parseInt(process.env.PRODUCTIVITY_COMPOSITE_TILE_HEIGHT || '600', 10) || 600;
const COMPOSITE_COLUMNS = Math.max(1, Math.min(8, parseInt(process.env.PRODUCTIVITY_COMPOSITE_COLUMNS || '4', 10) || 4));
const COMPOSITE_GAP = 0; // tight grid — UI overlays handle borders
const VALID_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp']);

function normalizeFormat(value, fallback = 'jpeg') {
  const raw = `${value || ''}`.toLowerCase();
  if (!VALID_FORMATS.has(raw)) return fallback;
  return raw === 'jpg' ? 'jpeg' : raw;
}

function formatToMime(format) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

const COMPOSITE_TILE_FORMAT = normalizeFormat(process.env.PRODUCTIVITY_COMPOSITE_TILE_FORMAT || 'jpeg', 'jpeg');
const COMPOSITE_OUTPUT_FORMAT = normalizeFormat(process.env.PRODUCTIVITY_COMPOSITE_OUTPUT_FORMAT || 'jpeg', 'jpeg');
const COMPOSITE_OUTPUT_MIME = formatToMime(COMPOSITE_OUTPUT_FORMAT);
// Quality is intentionally high so on-screen text in tiles is still readable
// when the AI receives the composite as a single image. For AI readability,
// slight quality reduction + chroma subsampling generally has minimal impact
// while cutting bytes substantially.
const COMPOSITE_WEBP_QUALITY = parseInt(process.env.PRODUCTIVITY_COMPOSITE_WEBP_QUALITY || '80', 10) || 80;
const COMPOSITE_JPEG_QUALITY = Math.max(30, Math.min(95, parseInt(process.env.PRODUCTIVITY_COMPOSITE_JPEG_QUALITY || '76', 10) || 76));
const COMPOSITE_JPEG_SUBSAMPLING = process.env.PRODUCTIVITY_COMPOSITE_JPEG_SUBSAMPLING || '4:4:4';
const COMPOSITE_PNG_COMPRESSION = Math.max(0, Math.min(9, parseInt(process.env.PRODUCTIVITY_COMPOSITE_PNG_COMPRESSION || '8', 10) || 8));
const COMPOSITE_PNG_COLORS = Math.max(16, Math.min(256, parseInt(process.env.PRODUCTIVITY_COMPOSITE_PNG_COLORS || '96', 10) || 96));

const TILE_WEBP_QUALITY = Math.max(30, Math.min(95, parseInt(process.env.PRODUCTIVITY_COMPOSITE_TILE_WEBP_QUALITY || '78', 10) || 78));
const TILE_JPEG_QUALITY = Math.max(30, Math.min(95, parseInt(process.env.PRODUCTIVITY_COMPOSITE_TILE_JPEG_QUALITY || '74', 10) || 74));
const TILE_JPEG_SUBSAMPLING = process.env.PRODUCTIVITY_COMPOSITE_TILE_JPEG_SUBSAMPLING || '4:4:4';
const TILE_PNG_COMPRESSION = Math.max(0, Math.min(9, parseInt(process.env.PRODUCTIVITY_COMPOSITE_TILE_PNG_COMPRESSION || '8', 10) || 8));
const TILE_PNG_COLORS = Math.max(16, Math.min(256, parseInt(process.env.PRODUCTIVITY_COMPOSITE_TILE_PNG_COLORS || '96', 10) || 96));
// Hard cap so a long day of captures cannot blow up sharp's canvas in memory.
const COMPOSITE_MAX_TILES = parseInt(process.env.PRODUCTIVITY_COMPOSITE_MAX_TILES || '600', 10) || 600;
const AI_ANALYSIS_MAX_WIDTH = Math.max(1200, Math.min(4800, parseInt(process.env.PRODUCTIVITY_AI_ANALYSIS_MAX_WIDTH || '2600', 10) || 2600));
const AI_ANALYSIS_WEBP_QUALITY = Math.max(45, Math.min(92, parseInt(process.env.PRODUCTIVITY_AI_ANALYSIS_WEBP_QUALITY || '72', 10) || 72));

async function encodeBuffer(image) {
  if (COMPOSITE_OUTPUT_FORMAT === 'jpeg') {
    return image.jpeg({
      quality: COMPOSITE_JPEG_QUALITY,
      mozjpeg: true,
      chromaSubsampling: COMPOSITE_JPEG_SUBSAMPLING,
      progressive: false,
    }).toBuffer();
  }
  if (COMPOSITE_OUTPUT_FORMAT === 'webp') {
    return image.webp({ quality: COMPOSITE_WEBP_QUALITY }).toBuffer();
  }
  return image.png({
    compressionLevel: COMPOSITE_PNG_COMPRESSION,
    palette: true,
    colors: COMPOSITE_PNG_COLORS,
  }).toBuffer();
}

async function encodeTileBuffer(image) {
  if (COMPOSITE_TILE_FORMAT === 'jpeg') {
    return image.jpeg({
      quality: TILE_JPEG_QUALITY,
      mozjpeg: true,
      chromaSubsampling: TILE_JPEG_SUBSAMPLING,
      progressive: false,
    }).toBuffer();
  }
  if (COMPOSITE_TILE_FORMAT === 'webp') {
    return image.webp({ quality: TILE_WEBP_QUALITY }).toBuffer();
  }
  return image.png({
    compressionLevel: TILE_PNG_COMPRESSION,
    palette: true,
    colors: TILE_PNG_COLORS,
  }).toBuffer();
}

function resolveLayoutFromComposite(composite) {
  return {
    columns: Math.max(1, Number(composite?.columns) || COMPOSITE_COLUMNS),
    tileWidth: Math.max(1, Number(composite?.tileWidth) || COMPOSITE_TILE_WIDTH),
    tileHeight: Math.max(1, Number(composite?.tileHeight) || COMPOSITE_TILE_HEIGHT),
    gap: Math.max(0, Number(composite?.gap) || COMPOSITE_GAP),
  };
}

function gridGeometry(tileCount, layout) {
  const columns = layout.columns;
  const rows = Math.max(1, Math.ceil(tileCount / columns));
  const width = columns * layout.tileWidth + (columns + 1) * layout.gap;
  const height = rows * layout.tileHeight + (rows + 1) * layout.gap;
  return { columns, rows, width, height };
}

function tileRect(globalIndex, layout) {
  const columns = layout.columns;
  const col = globalIndex % columns;
  const row = Math.floor(globalIndex / columns);
  const x = layout.gap + col * (layout.tileWidth + layout.gap);
  const y = layout.gap + row * (layout.tileHeight + layout.gap);
  return { x, y, width: layout.tileWidth, height: layout.tileHeight };
}

async function loadAndNormalizeTile(screenshotDoc, options) {
  const { ScreenshotModel, databaseName } = options;
  const loaded = await loadScreenshotForAnalysis(
    {
      _id: screenshotDoc._id,
      url: screenshotDoc.imagekitUrl || screenshotDoc.path || (screenshotDoc._id ? `/api/activity/screenshot?id=${screenshotDoc._id}` : null),
      path: screenshotDoc.path,
      gridfsFileId: screenshotDoc.gridfsFileId,
      capturedAt: screenshotDoc.capturedAt,
    },
    { ScreenshotModel, databaseName },
  );

  const buffer = Buffer.from(loaded.base64, 'base64');
  // Preserve the original screenshot's aspect ratio: scale it to fit inside
  // the tile box without cropping. Empty space around the image is filled
  // with the canvas background color so the tile rectangle stored in the
  // composite doc still maps 1:1 to the visible area in the UI.
  const normalized = await sharp(buffer, { failOnError: false })
    .rotate()
    .resize({
      width: COMPOSITE_TILE_WIDTH,
      height: COMPOSITE_TILE_HEIGHT,
      fit: 'contain',
      position: 'center',
      background: '#0F172A',
      withoutEnlargement: false,
    });

  return encodeTileBuffer(normalized);
}

async function loadExistingComposite(composite) {
  if (!composite?.gridfsFileId) return null;
  try {
    const buffer = await getScreenshot(composite.gridfsFileId, { databaseName: composite.databaseName });
    return buffer;
  } catch (err) {
    console.warn('[ScreenshotComposite] Failed to load existing composite, will rebuild empty:', err?.message);
    return null;
  }
}

/**
 * Append `newScreenshots` (Screenshot lean docs) to the composite for this
 * (user, dateString). Returns the updated ScreenshotComposite document plus
 * the IDs we successfully stitched (which the caller should then delete).
 *
 * @param {Object} args
 * @param {Array}  args.newScreenshots  Lean Screenshot docs (sorted by capturedAt).
 * @param {Array}  args.tileMetadata    Optional: per-screenshot AI metadata
 *                                      keyed by string(_id) for tile records.
 * @param {Object} args.tenant          { databaseName }
 * @param {String} args.userId
 * @param {String} args.employeeId
 * @param {String} args.dateString      'YYYY-MM-DD'
 */
export async function appendScreenshotsToComposite({
  newScreenshots,
  tileMetadata = {},
  tenant,
  userId,
  employeeId,
  dateString,
}) {
  if (!Array.isArray(newScreenshots) || newScreenshots.length === 0) {
    return { composite: null, stitchedIds: [], failedIds: [] };
  }

  const databaseName = tenant?.databaseName;
  const store = await getScreenshotStore(databaseName);

  let composite = await findScreenshotComposite(store, userId, dateString);
  const existingIds = new Set((composite?.tiles || []).map(tile => String(tile.originalScreenshotId)));
  const alreadyStitchedIds = newScreenshots.filter(record => existingIds.has(String(record._id))).map(record => record._id);
  newScreenshots = newScreenshots.filter(record => !existingIds.has(String(record._id)));
  if (!newScreenshots.length) {
    const loaded = await getCompositeImageBuffer({ tenant, userId, dateString });
    if (!loaded.buffer) throw new Error('Existing composite is unavailable; source captures have been preserved');
    return { composite, stitchedBuffer: loaded.buffer, stitchedIds: alreadyStitchedIds, failedIds: [] };
  }
  const layout = resolveLayoutFromComposite(composite);
  const previousTileCount = composite?.tileCount || 0;

  // Cap: don't keep growing forever — once the day is full just skip.
  if (previousTileCount >= COMPOSITE_MAX_TILES) {
    console.warn(
      `[ScreenshotComposite] Day ${dateString} for user ${userId} already at ${previousTileCount} tiles (cap ${COMPOSITE_MAX_TILES}); skipping append.`,
    );
    return { composite, stitchedIds: [], failedIds: newScreenshots.map((s) => s._id) };
  }

  const remainingCapacity = COMPOSITE_MAX_TILES - previousTileCount;
  const screenshotsToStitch = newScreenshots.slice(0, remainingCapacity);

  // Load + normalize each new screenshot. Skip any that fail to load.
  const tilesNormalized = [];
  const failedIds = [];
  for (const doc of screenshotsToStitch) {
    try {
      const buf = await loadAndNormalizeTile(doc, { databaseName });
      tilesNormalized.push({ doc, buffer: buf });
    } catch (err) {
      console.error(`[ScreenshotComposite] Skip screenshot ${doc._id}: ${err?.message || err}`);
      failedIds.push(doc._id);
    }
  }

  if (tilesNormalized.length === 0) {
    return { composite, stitchedIds: [], failedIds };
  }

  const totalTileCount = previousTileCount + tilesNormalized.length;
  const { columns, rows, width, height } = gridGeometry(totalTileCount, layout);

  // Start from an empty canvas; if a previous composite exists, paste it on
  // top-left first so its tile rectangles remain stable.
  let canvas = sharp({
    create: { width, height, channels: 4, background: '#0F172A' },
  });

  const composites = [];

  if (composite?.gridfsFileId) {
    const prevBuffer = await loadExistingComposite({ ...composite, databaseName });
    if (prevBuffer) {
      composites.push({ input: prevBuffer, left: 0, top: 0 });
    } else {
      // Previous binary lost — invalidate stored tile rects for safety.
      console.warn('[ScreenshotComposite] Previous composite binary missing; rebuilding without it.');
    }
  }

  const newTileRecords = [];
  tilesNormalized.forEach((entry, idx) => {
    const globalIndex = previousTileCount + idx;
    const rect = tileRect(globalIndex, layout);
    composites.push({ input: entry.buffer, left: rect.x, top: rect.y });
    const meta = tileMetadata[String(entry.doc._id)] || {};
    newTileRecords.push({
      index: globalIndex,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      capturedAt: entry.doc.capturedAt,
      originalScreenshotId: entry.doc._id,
      captureActiveApp: entry.doc?.activity?.activeApp || null,
      captureActiveWindow: entry.doc?.activity?.activeWindow || null,
      activity: meta.activity || null,
      productivity: meta.productivity || null,
      applicationVisible: meta.applicationVisible || null,
      websiteVisible: meta.websiteVisible || null,
    });
  });

  const allTiles = [...(composite?.tiles || []), ...newTileRecords];

  const rendered = canvas.composite(composites);
  const finalBuffer = await encodeBuffer(rendered);

  // Upload new composite.
  const uploadResult = await uploadScreenshot(finalBuffer, {
    databaseName,
    userId,
    employeeId,
    capturedAt: new Date(),
    mimeType: COMPOSITE_OUTPUT_MIME,
    format: COMPOSITE_OUTPUT_FORMAT,
    width,
    height,
    category: 'productivity-mosaic',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const oldGridfsId = composite?.gridfsFileId || null;

  let updated;
  try {
    updated = await store.transaction(async tx => {
      const id = composite?._id || createHash('sha256').update(`${userId}:${dateString}`).digest('hex').slice(0, 24);
      const current = await tx.get('screenshotcomposites', id);
      if ((current?.gridfsFileId || null) !== oldGridfsId || (current?.tileCount || 0) !== previousTileCount) throw new Error('Composite changed during stitching; retry this batch');
      const next = {
        ...current,
        _id: id,
        createdAt: current?.createdAt || new Date(),
        updatedAt: new Date(),
        user: String(userId),
        employee: employeeId ? String(employeeId) : null,
        dateString,
        date: new Date(`${dateString}T00:00:00.000Z`),
        gridfsFileId: uploadResult._id,
        mimeType: COMPOSITE_OUTPUT_MIME,
        width,
        height,
        columns,
        rows,
        tileWidth: layout.tileWidth,
        tileHeight: layout.tileHeight,
        gap: layout.gap,
        tileCount: allTiles.length,
        tiles: allTiles,
        byteSize: finalBuffer.length,
        lastStitchedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      if (current) await tx.replace('screenshotcomposites', next);
      else await tx.create('screenshotcomposites', next);
      return next;
    });
  } catch (error) {
    await deleteScreenshots([uploadResult._id], { databaseName }).catch(() => {});
    throw error;
  }

  // Delete the OLD composite blob now that the new one is saved.
  if (oldGridfsId) {
    try {
      await deleteScreenshots([oldGridfsId], { databaseName });
    } catch (err) {
      console.warn(`[ScreenshotComposite] Failed to delete previous composite blob ${oldGridfsId}:`, err?.message);
    }
  }

  const stitchedIds = [...alreadyStitchedIds, ...tilesNormalized.map((e) => e.doc._id)];
  return { composite: updated, stitchedBuffer: finalBuffer, stitchedIds, failedIds };
}

/**
 * Apply per-tile AI metadata after a vision call. Map keys are stringified
 * Screenshot ObjectIds (the IDs of the original captures that were stitched).
 * Tiles whose `originalScreenshotId` matches receive the metadata fields.
 */
export async function updateCompositeTileMetadata({
  tenant,
  userId,
  dateString,
  metadataByScreenshotId,
}) {
  if (!metadataByScreenshotId || Object.keys(metadataByScreenshotId).length === 0) {
    return { updatedTiles: 0 };
  }
  const store = await getScreenshotStore(tenant?.databaseName);
  const composite = await findScreenshotComposite(store, userId, dateString);
  if (!composite || !Array.isArray(composite.tiles) || composite.tiles.length === 0) {
    return { updatedTiles: 0 };
  }

  let updatedTiles = 0;
  await store.mutate('screenshotcomposites', composite._id, current => {
    updatedTiles = 0;
    for (const tile of current.tiles || []) {
    const meta = metadataByScreenshotId[String(tile.originalScreenshotId)];
    if (!meta) continue;
    if (meta.activity !== undefined) tile.activity = meta.activity;
    if (meta.productivity !== undefined) tile.productivity = meta.productivity;
    if (meta.applicationVisible !== undefined) tile.applicationVisible = meta.applicationVisible;
    if (meta.websiteVisible !== undefined) tile.websiteVisible = meta.websiteVisible;
    updatedTiles += 1;
    }
    return { ...current, updatedAt: new Date() };
  });
  return { updatedTiles };
}

/**
 * Load the current composite WebP buffer from GridFS for a given (user, day).
 * Returns null if no composite exists yet or the blob has been lost.
 */
export async function getCompositeImageBuffer({ tenant, userId, dateString }) {
  const store = await getScreenshotStore(tenant?.databaseName);
  const composite = await findScreenshotComposite(store, userId, dateString);
  if (!composite?.gridfsFileId) return { composite: null, buffer: null };
  try {
    const buffer = await getScreenshot(composite.gridfsFileId, { databaseName: tenant?.databaseName });
    return { composite, buffer };
  } catch (err) {
    console.warn('[ScreenshotComposite] getCompositeImageBuffer failed:', err?.message);
    return { composite, buffer: null };
  }
}

/**
 * Re-encode a stored composite buffer specifically for AI vision calls.
 * Converts to grayscale so all colour-channel data is stripped (reducing
 * file size ~60 %) while bumping JPEG quality to 92 to eliminate the DCT
 * ringing/blur that low-quality colour JPEG introduces on on-screen text.
 * The stored display composite is NOT modified — this only affects the bytes
 * handed to the AI model.
 *
 * @param {Buffer} buffer  Raw buffer of the stored composite image.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function prepareCompositeForAIAnalysis(buffer) {
  const analysisBuffer = await sharp(buffer, { failOnError: false })
    .grayscale()
    .resize({
      width: AI_ANALYSIS_MAX_WIDTH,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: AI_ANALYSIS_WEBP_QUALITY })
    .toBuffer();
  return { buffer: analysisBuffer, mimeType: 'image/webp' };
}

/**
 * Hard-delete the original Screenshot docs and their GridFS blobs after they
 * have been folded into the composite.
 */
export async function purgeStitchedScreenshots({ tenant, screenshotIds }) {
  if (!Array.isArray(screenshotIds) || screenshotIds.length === 0) return { deleted: 0, gridfsDeleted: 0 };
  const databaseName = tenant?.databaseName;
  const store = await getScreenshotStore(databaseName);

  const docs = [];
  for (let offset = 0; offset < screenshotIds.length; offset += 100) docs.push(...(await store.getMany('screenshots', screenshotIds.slice(offset, offset + 100).map(String))).filter(Boolean));

  const gridfsIds = docs.map((d) => d.gridfsFileId).filter(Boolean);
  let gridfsDeleted = 0;
  const failedIds = new Set();
  if (gridfsIds.length > 0) {
    try {
      const res = await deleteScreenshots(gridfsIds, { databaseName });
      gridfsDeleted = res?.successCount || 0;
      for (const failure of res?.errors || []) failedIds.add(String(failure.fileId));
    } catch (err) {
      console.warn('[ScreenshotComposite] Private media bulk delete failed:', err?.message);
      for (const id of gridfsIds) failedIds.add(String(id));
    }
  }

  const removed = docs.filter(doc => !failedIds.has(String(doc.gridfsFileId)));
  for (let offset = 0; offset < removed.length; offset += 50) await store.transaction(async tx => {
    for (const doc of removed.slice(offset, offset + 50)) await tx.delete('screenshots', String(doc._id));
  });
  return { deleted: removed.length, gridfsDeleted };
}

export const COMPOSITE_GEOMETRY = {
  TILE_WIDTH: COMPOSITE_TILE_WIDTH,
  TILE_HEIGHT: COMPOSITE_TILE_HEIGHT,
  COLUMNS: COMPOSITE_COLUMNS,
  GAP: COMPOSITE_GAP,
  MAX_TILES: COMPOSITE_MAX_TILES,
  OUTPUT_FORMAT: COMPOSITE_OUTPUT_FORMAT,
  OUTPUT_MIME: COMPOSITE_OUTPUT_MIME,
};
