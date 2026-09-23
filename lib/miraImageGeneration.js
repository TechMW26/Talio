export function validateMiraImageAction(action) {
  const prompt = action?.fields?.prompt
  if (action?.type !== 'generate_image' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) return null
  return { type: 'generate_image', fields: { prompt: prompt.trim() } }
}

export const MIRA_IMAGE_INSTRUCTIONS = `You can generate an image when the user asks you to create, draw, render or generate a visual. Return action {"type":"generate_image","fields":{"prompt":"a complete visual description"}}. Include requested subject, composition, style and exact text in the prompt, using relevant conversation context. Ask only if the subject is missing. Do not generate for image searches, descriptions, hypothetical, quoted or negated requests. Do not claim an image is ready before the generation result. Never invent an image URL. Image editing/reference uploads are not supported by this tool; describe that limitation honestly. Generate one image per request. The message should be a brief acknowledgement in the user's language.`
