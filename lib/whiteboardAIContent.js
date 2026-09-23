import { normalizeWhiteboardDiagram } from './whiteboardAIPlan';
const MAX_SECTIONS = 20;
const MAX_ITEMS_PER_SECTION = 50;

function toText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    return toText(value.text || value.title || value.label || value.content);
  }
  return '';
}

function defaultTitle(templateType, prompt) {
  const template = toText(templateType) || 'diagram';
  const topic = toText(prompt).slice(0, 80);
  const label = template.charAt(0).toUpperCase() + template.slice(1);
  return topic ? `${label}: ${topic}` : `${label} workspace`;
}

/**
 * Normalize model-generated whiteboard content before it reaches persistence
 * or the canvas. This keeps partially recovered AI JSON useful while rejecting
 * responses that cannot produce any visible content.
 */
export function normalizePreparedWhiteboardContent(content, options = {}) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new TypeError('AI content must be a JSON object');
  }

  const templateType = toText(content.templateType) || toText(options.templateType) || 'mindmap';
  const sections = (Array.isArray(content.sections) ? content.sections : [])
    .slice(0, content.diagram ? 16 : MAX_SECTIONS)
    .map((section, index) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return null;

      const items = (Array.isArray(section.items) ? section.items : [])
        .slice(0, content.diagram ? 8 : MAX_ITEMS_PER_SECTION)
        .map(item => toText(item).slice(0, 500))
        .filter(Boolean);
      const summary = toText(section.summary).slice(0, 500);
      const title = toText(section.title).slice(0, 120) || `Section ${index + 1}`;

      if (items.length === 0 && !summary) return null;

      return {
        ...section,
        id: toText(section.id) || `s${index + 1}`,
        type: toText(section.type) || 'section',
        title,
        items,
        summary,
      };
    })
    .filter(Boolean);

  if (sections.length === 0) {
    throw new TypeError('AI content did not include any usable sections');
  }
  const ids = new Set();
  for (const section of sections) {
    if (ids.has(section.id)) throw new TypeError('Duplicate section ID');
    ids.add(section.id);
  }

  return {
    ...content,
    title: toText(content.title) || defaultTitle(templateType, options.prompt),
    description: toText(content.description),
    templateType,
    sections,
    diagram: normalizeWhiteboardDiagram(content.diagram, sections),
    conclusion: toText(content.conclusion),
    metadata: content.metadata && typeof content.metadata === 'object' && !Array.isArray(content.metadata)
      ? content.metadata
      : {},
  };
}
