import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

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
    const prompt = `You are a creative business consultant helping employees develop their ideas for workplace improvements.

Given the following idea, please expand on it with:
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

    // Try Gemini first, then fall back to OpenAI
    let expansion = null;

    // Try Gemini - use both possible env var names
    const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (geminiKey) {
      try {
        console.log('[Ideas Expand] Trying Gemini...')
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024,
              }
            })
          }
        );

        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          console.log('[Ideas Expand] Gemini response received')
          if (text) {
            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              expansion = JSON.parse(jsonMatch[0]);
              console.log('[Ideas Expand] Successfully parsed Gemini response')
            }
          }
        } else {
          const errorText = await geminiResponse.text();
          console.log('[Ideas Expand] Gemini error:', geminiResponse.status, errorText);
        }
      } catch (geminiError) {
        console.log('[Ideas Expand] Gemini expansion failed:', geminiError.message);
      }
    } else {
      console.log('[Ideas Expand] No Gemini API key found')
    }

    // Fall back to OpenAI if Gemini failed
    if (!expansion) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          console.log('[Ideas Expand] Trying OpenAI...')
          const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a helpful business consultant. Always respond with valid JSON.' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.7,
              max_tokens: 1024
            })
          });

          if (openaiResponse.ok) {
            const openaiData = await openaiResponse.json();
            const text = openaiData.choices?.[0]?.message?.content;
            console.log('[Ideas Expand] OpenAI response received')
            if (text) {
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                expansion = JSON.parse(jsonMatch[0]);
                console.log('[Ideas Expand] Successfully parsed OpenAI response')
              }
            }
          } else {
            const errorText = await openaiResponse.text();
            console.log('[Ideas Expand] OpenAI error:', openaiResponse.status, errorText);
          }
        } catch (openaiError) {
          console.log('[Ideas Expand] OpenAI expansion failed:', openaiError.message);
        }
      } else {
        console.log('[Ideas Expand] No OpenAI API key found')
      }
    }

    if (!expansion) {
      console.log('[Ideas Expand] All AI services unavailable')
      return NextResponse.json(
        { success: false, message: 'AI service unavailable. Please ensure GEMINI_API_KEY or OPENAI_API_KEY is configured.' },
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
