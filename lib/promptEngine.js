import { generateContent } from './gemini';
import AIContext from '@/models/AIContext';
import connectDB from '@/lib/mongodb';

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
export async function getContext(userId, feature, limit = 5) {
  try {
    await connectDB();
    const history = await AIContext.find({ userId, feature })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return history.reverse().map(h => `User: ${h.originalInput}\nAI: ${h.response}`).join('\n\n');
  } catch (e) {
    console.error("Failed to fetch context:", e);
    return "";
  }
}

/**
 * Saves the interaction to the database
 */
export async function saveContext(userId, feature, originalInput, refinedPrompt, response, metadata = {}) {
  try {
    await connectDB();
    await AIContext.create({
      userId,
      feature,
      originalInput,
      refinedPrompt,
      response,
      metadata
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
export async function generateSmartContent(userPrompt, options = {}) {
  const {
    userId,
    feature,
    systemInstruction = '',
    metadata = {},
    skipRefinement = false,
    skipGuardrails = false,
    skipContext = false,
    skipSaveContext = false
  } = options;

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
    context = await getContext(userId, feature);
  }

  // 3. Construct Full Prompt
  const fullSystemInstruction = skipGuardrails
    ? systemInstruction
    : `${GUARDRAILS}\n\n${systemInstruction}`;

  const promptWithContext = context
    ? `PREVIOUS CONVERSATION:\n${context}\n\nCURRENT REQUEST:\n${finalPrompt}`
    : finalPrompt;

  // 4. Generate
  const response = await generateContent(promptWithContext, fullSystemInstruction);

  // 5. Save Context
  if (userId && feature && !skipSaveContext) {
    // Fire and forget save
    saveContext(userId, feature, userPrompt, refinedPrompt, response, metadata);
  }

  return response;
}
