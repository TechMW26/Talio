const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Models to try in order of preference for text
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash', 
  'gemini-1.5-flash',
  'gemini-1.5-pro', 
  'gemini-pro'
];

// Vision-capable models in order of preference
// Note: Gemini has more lenient content policies for workplace screenshots
const GEMINI_VISION_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro-vision'
];

// Perplexity models
const PERPLEXITY_MODELS = [
  'sonar-pro',
  'sonar',
  'llama-3.1-sonar-large-128k-online'
];

/**
 * Check if an error/response indicates content policy violation
 */
function isContentPolicyError(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('unable to') ||
    lower.includes('cannot analyze') ||
    lower.includes('cannot process') ||
    lower.includes('cannot identify') ||
    lower.includes("can't analyze") ||
    lower.includes("i'm sorry") ||
    lower.includes('content policy') ||
    lower.includes('safety') ||
    lower.includes('inappropriate') ||
    lower.includes('not allowed') ||
    lower.includes('violates') ||
    lower.includes('harmful') ||
    lower.includes('blocked')
  );
}

/**
 * Fallback to Perplexity for text generation (3rd fallback)
 */
async function generatePerplexityContent(prompt, systemInstruction = '') {
  if (!PERPLEXITY_API_KEY) {
    throw new Error('Perplexity API key not configured for fallback');
  }

  console.log('🔮 Falling back to Perplexity AI...');
  
  for (const model of PERPLEXITY_MODELS) {
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemInstruction || 'You are a helpful AI assistant. Respond directly without citations or search references.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 4096
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Perplexity succeeded with model: ${model}`);
        return data.choices?.[0]?.message?.content || '';
      }

      if (response.status === 404 || response.status === 400) {
        console.warn(`⚠️ Perplexity model ${model} not available, trying next...`);
        continue;
      }

      const errorText = await response.text();
      console.error(`Perplexity API error with ${model}: ${response.status}`, errorText);
      
      if (response.status === 429) {
        throw new Error(`Perplexity rate limited: ${errorText}`);
      }
    } catch (error) {
      if (error.message.includes('rate limited')) throw error;
      console.error(`Perplexity ${model} failed:`, error.message);
    }
  }

  throw new Error('All Perplexity models failed');
}

/**
 * Fallback to OpenAI for text generation (2nd fallback)
 */
async function generateOpenAIContent(prompt, systemInstruction = '') {
  if (!OPENAI_API_KEY) {
    if (PERPLEXITY_API_KEY) {
      return generatePerplexityContent(prompt, systemInstruction);
    }
    throw new Error('OpenAI API key not configured for fallback');
  }

  console.log('🤖 Falling back to OpenAI (gpt-4o-mini)...');
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemInstruction || 'You are a helpful AI assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error: ${response.status}`, errorText);
      
      if (PERPLEXITY_API_KEY) {
        console.warn('⚠️ OpenAI failed, trying Perplexity...');
        return generatePerplexityContent(prompt, systemInstruction);
      }
      
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ OpenAI succeeded');
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    if (PERPLEXITY_API_KEY && !error.message.includes('Perplexity')) {
      console.warn('⚠️ OpenAI failed, trying Perplexity...', error.message);
      return generatePerplexityContent(prompt, systemInstruction);
    }
    throw error;
  }
}

/**
 * Try Gemini Vision with progressive image reduction on content policy errors
 * This helps when some images trigger safety filters
 */
async function tryGeminiVisionWithRetry(prompt, images, maxRetries = 3) {
  let currentImages = [...images];
  let attempt = 0;
  
  while (attempt < maxRetries && currentImages.length > 0) {
    attempt++;
    
    const parts = [];
    currentImages.forEach(img => {
      parts.push({
        inline_data: {
          mime_type: img.mimeType || 'image/png',
          data: img.data
        }
      });
    });
    parts.push({ text: prompt });

    const payload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      },
      // Add safety settings to be more permissive for workplace content
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
      ]
    };

    for (const model of GEMINI_VISION_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          
          // Check if response is a content policy refusal
          if (isContentPolicyError(text)) {
            console.warn(`⚠️ Gemini ${model} returned content policy message, trying with fewer images...`);
            break; // Break inner loop, reduce images
          }
          
          console.log(`✅ Gemini Vision succeeded with model: ${model} (${currentImages.length} images)`);
          return { success: true, text, imagesUsed: currentImages.length };
        }

        // Check for safety/content blocks in response
        if (response.status === 400) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData.error?.message?.toLowerCase().includes('safety') ||
              errorData.error?.message?.toLowerCase().includes('block')) {
            console.warn(`⚠️ Gemini ${model} blocked due to safety, reducing images...`);
            break; // Break inner loop, reduce images
          }
        }

        if (response.status === 404) {
          console.warn(`⚠️ Gemini Vision model ${model} not found, trying next...`);
          continue;
        }

        if (response.status === 503) {
          console.warn(`⚠️ Gemini Vision model ${model} overloaded, trying next...`);
          continue;
        }

        if (response.status === 429) {
          console.warn(`⚠️ Gemini Vision rate limited`);
          return { success: false, rateLimited: true };
        }

        const errorText = await response.text();
        console.error(`Gemini Vision API error with ${model}: ${response.status}`, errorText);
      } catch (error) {
        console.error(`Gemini Vision ${model} failed:`, error.message);
      }
    }

    // Reduce images for next attempt - remove every other image
    if (currentImages.length > 2) {
      const reducedImages = currentImages.filter((_, i) => i % 2 === 0);
      console.log(`📉 Reducing images from ${currentImages.length} to ${reducedImages.length} for retry...`);
      currentImages = reducedImages;
    } else if (currentImages.length === 2) {
      // Try with just the first image
      currentImages = [currentImages[0]];
      console.log(`📉 Trying with single image...`);
    } else {
      // Only one image left and it still failed
      break;
    }
  }
  
  return { success: false };
}

/**
 * Generate content using Google Gemini API with OpenAI and Perplexity fallbacks
 * Fallback chain: Gemini → OpenAI → Perplexity
 */
export async function generateContent(prompt, systemInstruction = '') {
  if (!GEMINI_API_KEY) {
    if (OPENAI_API_KEY) return generateOpenAIContent(prompt, systemInstruction);
    if (PERPLEXITY_API_KEY) return generatePerplexityContent(prompt, systemInstruction);
    console.error('No AI API keys configured');
    throw new Error('AI service is not configured');
  }

  const payload = {
    contents: [{
      parts: [{
        text: systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt
      }]
    }],
    generationConfig: {
      temperature: 0.7,
    }
  };

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Gemini succeeded with model: ${model}`);
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      if (response.status === 404) {
        console.warn(`⚠️ Gemini model ${model} not found, trying next...`);
        continue;
      }

      if (response.status === 503) {
        console.warn(`⚠️ Gemini model ${model} overloaded, trying next...`);
        continue;
      }

      if (response.status === 429) {
        console.warn(`⚠️ Gemini rate limited, falling back to OpenAI...`);
        return generateOpenAIContent(prompt, systemInstruction);
      }

      const errorText = await response.text();
      console.error(`Gemini API error with ${model}: ${response.status}`, errorText);
    } catch (error) {
      console.error(`Gemini ${model} failed:`, error.message);
    }
  }

  console.warn('⚠️ All Gemini models failed, falling back to OpenAI...');
  return generateOpenAIContent(prompt, systemInstruction);
}

/**
 * Generate content from text and images using Google Gemini API
 * 
 * IMPORTANT: This function prioritizes Gemini for vision tasks because:
 * 1. Gemini has more lenient content policies for workplace screenshots
 * 2. OpenAI Vision often refuses to analyze desktop screenshots citing content policies
 * 3. We use progressive image reduction if some images trigger safety filters
 * 
 * If all attempts fail, throws an error so the caller can handle it appropriately
 * (e.g., show retry button to user instead of saving fake data)
 */
export async function generateVisionContent(prompt, images = []) {
  if (!GEMINI_API_KEY) {
    // Without Gemini, we cannot analyze images - throw error
    console.error('❌ No Gemini API key configured for vision analysis');
    throw new Error('AI_VISION_UNAVAILABLE: Gemini API key is required for image analysis');
  }

  // Try Gemini with progressive retry (reduces images on content policy errors)
  const geminiResult = await tryGeminiVisionWithRetry(prompt, images);
  
  if (geminiResult.success) {
    return geminiResult.text;
  }
  
  // All attempts failed - throw appropriate error so caller can handle
  if (geminiResult.rateLimited) {
    console.error('❌ Gemini Vision rate limited, cannot analyze');
    throw new Error('AI_RATE_LIMITED: AI service is temporarily rate limited. Please try again in a few minutes.');
  }
  
  if (geminiResult.contentPolicy) {
    console.error('❌ Gemini Vision blocked by content policy');
    throw new Error('AI_CONTENT_POLICY: Some screenshots could not be analyzed due to content policies. Please try again later.');
  }
  
  console.error('❌ All Gemini Vision attempts failed');
  throw new Error('AI_VISION_FAILED: Unable to analyze screenshots. Please try again later.');
}

/**
 * Check which AI services are available
 */
export function getAIAvailability() {
  return {
    gemini: !!GEMINI_API_KEY,
    openai: !!OPENAI_API_KEY,
    perplexity: !!PERPLEXITY_API_KEY,
    anyAvailable: !!(GEMINI_API_KEY || OPENAI_API_KEY || PERPLEXITY_API_KEY)
  };
}
