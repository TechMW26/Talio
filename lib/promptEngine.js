import { generateContent } from './gemini';
import { randomBytes } from 'node:crypto';
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server';

const GUARDRAILS = `
RESPONSE GUIDELINES:
1. Respond in a natural, conversational human manner.
2. Do NOT use markdown formatting like bold (**), italics (*), bullet points (- or *), or numbered lists unless absolutely necessary for data structures.
3. Avoid robotic transitions or "Here is the..." phrases.
4. Write in clear, flowing paragraphs.
5. Be helpful and direct.
`;

/**
 * Refines a crude user prompt into a detailed AI prompt
 */
export async function refinePrompt(crudeInput) {
  const refinementPrompt = `
    You are an expert prompt engineer. Your task is to convert the following crude user input into a high-quality, detailed prompt for an AI model.
    
    CRUDE INPUT: "${crudeInput}"
    
    INSTRUCTIONS:
    1. Clarify the intent.
    2. Add necessary context or constraints implied by the input.
    3. Format it to get the best possible response.
    4. Return ONLY the refined prompt text, nothing else.
  `;

  try {
    const refined = await generateContent(refinementPrompt);
    return refined.trim();
  } catch (e) {
    console.error("Prompt refinement failed:", e);
    return crudeInput; // Fallback
  }
}

/**
 * Retrieves conversation history from the database
 */
export async function getContext(userId, feature, limit = 5, databaseName) {
  if (!databaseName || !userId || !feature) throw new Error('Tenant context is required for AI history');
  try {
    const store = await getFirestoreTenantDatabase(databaseName, { queryFields: { aicontexts: ['userId', 'feature', 'createdAt'] } });
    const history = (await store.list('aicontexts', {
      filters: [{ field: 'userId', operator: '==', value: String(userId) }, { field: 'feature', operator: '==', value: feature }, { field: 'createdAt', operator: '>=', value: new Date(Date.now() - 30 * 86400000) }],
      orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: Math.min(100, Math.max(1, limit)),
    })).records;

    return history.reverse().map(h => `User: ${h.originalInput}\nAI: ${h.response}`).join('\n\n');
  } catch (e) {
    console.error("Failed to fetch context:", e);
    return "";
  }
}

/**
 * Saves the interaction to the database
 */
export async function saveContext(userId, feature, originalInput, refinedPrompt, response, metadata = {}, databaseName) {
  if (!databaseName || !userId || !feature) throw new Error('Tenant context is required for AI history');
  try {
    const store = await getFirestoreTenantDatabase(databaseName);
    if (!await store.get('users', String(userId))) throw new Error('AI context owner not found in tenant');
    await store.create('aicontexts', {
      _id: randomBytes(12).toString('hex'), userId: String(userId),
      feature,
      originalInput,
      refinedPrompt,
      response,
      metadata, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000),
    });
  } catch (e) {
    console.error("Failed to save context:", e);
  }
}

/**
 * Main function to generate content with prompt engineering, context, and guardrails
 * @param {string} userPrompt - The raw user input
 * @param {Object} options - Configuration options
 * @returns {Promise<string>} - The generated response
 */
/**
 * Maps feature names to AI use cases so each feature automatically
 * routes to the best model (see lib/ai/models.js → AI_USE_CASES).
 */
const FEATURE_USE_CASES = {
  'performance-insights': 'analysis',
  'project-analytics': 'analysis',
  'project-summary': 'analysis',
  'productivity-analysis': 'analysis',
  'designation-ranking': 'analysis',
  'profile-kri-generation': 'analysis',
  'profile-kpi-generation': 'analysis',
  'whiteboard-analyze': 'analysis',
  'whiteboard-generate': 'creative',
  'whiteboard-continue': 'creative',
  'whiteboard-restructure': 'creative',
  'whiteboard-prepare': 'creative',
  'whiteboard-expand-section': 'creative',
  'whiteboard-regenerate-section': 'creative',
  'whiteboard-edit-content': 'creative',
  'mail-compose': 'chat',
};

export async function generateSmartContent(userPrompt, options = {}) {
  const {
    userId,
    databaseName,
    feature,
    useCase,
    systemInstruction = '',
    metadata = {},
    skipRefinement = false,
    skipGuardrails = false,
    skipContext = false,
    skipSaveContext = false
  } = options;
  if (userId && feature && (!skipContext || !skipSaveContext) && !databaseName) throw new Error('Tenant context is required for AI history');

  // 1. Refine Prompt
  let finalPrompt = userPrompt;
  let refinedPrompt = userPrompt;

  if (!skipRefinement) {
    refinedPrompt = await refinePrompt(userPrompt);
    finalPrompt = refinedPrompt;
  }

  // 2. Get Context
  let context = '';
  if (userId && feature && !skipContext) {
    context = await getContext(userId, feature, 5, databaseName);
  }

  // 3. Construct Full Prompt
  const fullSystemInstruction = skipGuardrails
    ? systemInstruction
    : `${GUARDRAILS}\n\n${systemInstruction}`;

  const promptWithContext = context
    ? `PREVIOUS CONVERSATION:\n${context}\n\nCURRENT REQUEST:\n${finalPrompt}`
    : finalPrompt;

  // 4. Generate
  const resolvedUseCase = useCase || FEATURE_USE_CASES[feature] || 'default';
  const response = await generateContent(promptWithContext, fullSystemInstruction, {
    useCase: resolvedUseCase,
    maxTokens: options.maxTokens, thinking: options.thinking,
    signal: options.signal, timeoutMs: options.timeoutMs, maxAttempts: options.maxAttempts,
  });

  // 5. Save Context
  if (userId && feature && !skipSaveContext) {
    // Complete persistence before returning on serverless runtimes.
    await saveContext(userId, feature, userPrompt, refinedPrompt, response, metadata, databaseName);
  }

  return response;
}
