import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { generateContent } from '@/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FALLBACK_WORDS = [
  'Analyzing data',
  'Mapping activity patterns',
  'Reading screen context',
  'Understanding work flow',
  'Refining productivity insights',
  'Correlating captured signals',
  'Synthesizing day summary',
  'Evaluating focus quality',
  'Finalizing analysis output',
  'Preparing final insights',
];

function toTitleCase(value) {
  return value
    .split(' ')
    .map((w) => (w ? `${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}` : ''))
    .join(' ')
    .trim();
}

function sanitizePhrase(phrase) {
  if (!phrase || typeof phrase !== 'string') return null;
  const cleaned = phrase
    .trim()
    .replace(/[^a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const words = cleaned
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.slice(0, 18));

  if (words.length === 0) return null;
  const longEnough = words.some((w) => w.length >= 3);
  if (!longEnough) return null;

  return toTitleCase(words.join(' '));
}

function uniqueWords(words) {
  const seen = new Set();
  const out = [];
  for (const raw of words || []) {
    const w = sanitizePhrase(raw);
    if (!w) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, []);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const context = `${body?.context || ''}`.slice(0, 300);
    const route = `${body?.route || ''}`.slice(0, 120);
    const intentLabel = `${body?.intentLabel || 'General'}`.slice(0, 60);
    const moduleTitle = `${body?.moduleTitle || ''}`.slice(0, 120);
    const count = Math.max(6, Math.min(18, Number(body?.count) || 10));

    const systemInstruction =
      'You generate concise English loading phrases for live UI states. ' +
      'Each phrase must be relevant and action-oriented. ' +
      'Return ONLY valid minified JSON with key "words" containing a string array.';

    const prompt = [
      'Create dynamic loading words for an AI animation.',
      `Context: ${context || 'General AI processing'}`,
      `Intent Label: ${intentLabel || 'General'}`,
      `Module Title: ${moduleTitle || 'Unknown'}`,
      `Route: ${route || 'unknown'}`,
      `Need exactly ${count} words.`,
      'Rules:',
      '- Each item can be 1 to 5 words.',
      '- Keep every phrase relevant to the Intent Label and Module Title.',
      '- Use only alphabetic words (no punctuation, no numbers).',
      '- Keep each phrase short and display-friendly.',
      '- Present-progressive or action-oriented wording preferred (example style only: Analyzing Data, Mapping Activity Patterns).',
      '- No punctuation, no numbers, no markdown.',
      '- No duplicates.',
      'Output format strictly: {"words":["Word1","Word2"]}',
    ].join('\n');

    const raw = await generateContent(prompt, systemInstruction, { useCase: 'creative' });

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const block = `${raw || ''}`.match(/\{[\s\S]*\}/);
      if (block) {
        try {
          parsed = JSON.parse(block[0]);
        } catch {
          parsed = null;
        }
      }
    }

    const aiWords = uniqueWords(parsed?.words || []);
    const words = aiWords.length >= 4
      ? aiWords.slice(0, count)
      : uniqueWords([...aiWords, ...FALLBACK_WORDS]).slice(0, count);

    return NextResponse.json({ success: true, words });
  } catch (error) {
    console.error('[AI Loading Words] Error:', error?.message || error);
    return NextResponse.json({ success: true, words: FALLBACK_WORDS });
  }
}
