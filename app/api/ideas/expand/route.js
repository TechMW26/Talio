import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { generateContent } from '@/lib/gemini';

/**
 * POST /api/ideas/expand
 * Use AI to expand an idea with more details and suggestions
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, []);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user } = auth;

    const body = await request.json();
    const { title, description, category } = body;

    console.log('[Ideas Expand] Request:', { title, category, hasDescription: !!description })

    if (!title?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Title is required for AI expansion' },
        { status: 400 }
      );
    }

    // Build the prompt for AI expansion
    const prompt = `Given the following idea, please expand on it with:
1. A more detailed description (2-3 paragraphs)
2. Potential benefits (3-5 bullet points)
3. Implementation steps (3-5 numbered steps)
4. Potential challenges and how to address them (2-3 points)

Keep the tone professional but engaging. Make practical, actionable suggestions.

Idea Title: ${title}
${description ? `Current Description: ${description}` : ''}
${category ? `Category: ${category}` : ''}

Please respond in the following JSON format:
{
  "expandedDescription": "...",
  "benefits": ["benefit1", "benefit2", ...],
  "implementationSteps": ["step1", "step2", ...],
  "challenges": [{"challenge": "...", "solution": "..."}, ...]
}`;

    const systemInstruction = 'You are a creative business consultant helping employees develop their ideas for workplace improvements. Always respond with valid JSON.';

    // Use the centralized custom AI provider.
    let expansion = null;

    try {
      console.log('[Ideas Expand] Using centralized custom AI...');
      const text = await generateContent(prompt, systemInstruction);

      if (text) {
        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          expansion = JSON.parse(jsonMatch[0]);
          console.log('[Ideas Expand] Successfully parsed AI response');
        }
      }
    } catch (aiError) {
      console.log('[Ideas Expand] AI expansion failed:', aiError.message);
    }

    if (!expansion) {
      console.log('[Ideas Expand] All AI services unavailable')
      return NextResponse.json(
        { success: false, message: 'AI service unavailable. Please ensure at least one AI provider is configured.' },
        { status: 503 }
      );
    }

    console.log('[Ideas Expand] Successfully expanded idea')
    return NextResponse.json({
      success: true,
      data: expansion
    });

  } catch (error) {
    console.error('[Ideas] AI expand error:', error);
    console.error('[Ideas] AI expand error stack:', error.stack);
    return NextResponse.json(
      { success: false, message: 'Failed to expand idea', error: error.message },
      { status: 500 }
    );
  }
}
