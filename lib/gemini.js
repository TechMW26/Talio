// Primary and fallback Gemini API keys - tried in order
const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_AADIL,
  process.env.GEMINI_API_KEY_RITHIK,
  process.env.GEMINI_API_KEY_SAHIL,
  process.env.GEMINI_API_KEY_TECH,
].filter(Boolean); // Remove any undefined keys

const GEMINI_API_KEY = GEMINI_API_KEYS[0]; // For backward compatibility
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Models to try in order of preference for text (updated for 2026)
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash', 
  'gemini-2.0-flash-lite'
];

// Vision-capable models in order of preference (updated for 2026)
// Note: Gemini has more lenient content policies for workplace screenshots
const GEMINI_VISION_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
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
 * Try Gemini Vision with ALL images - no skipping
 * If Gemini fails, caller should try fallback providers with the same images
 * Now tries ALL API keys before failing
 */
async function tryGeminiVision(prompt, images) {
  const parts = [];
  images.forEach(img => {
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

  // Try each API key, then each model
  for (let keyIndex = 0; keyIndex < GEMINI_API_KEYS.length; keyIndex++) {
    const apiKey = GEMINI_API_KEYS[keyIndex];
    const keyLabel = keyIndex === 0 ? 'Primary' : `Fallback-${keyIndex}`;
    
    for (const model of GEMINI_VISION_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    try {
      console.log(`🔷 Trying Gemini Vision [${keyLabel}] model: ${model} with ${images.length} images...`);
      
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
          console.warn(`⚠️ Gemini [${keyLabel}] ${model} returned content policy message, trying next...`);
          continue; // Try next model
        }
        
        console.log(`✅ Gemini Vision succeeded [${keyLabel}] with model: ${model} (${images.length} images)`);
        return { success: true, text, imagesUsed: images.length };
      }

      // Handle specific error codes
      if (response.status === 400) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error?.message?.toLowerCase().includes('safety') ||
            errorData.error?.message?.toLowerCase().includes('block')) {
          console.warn(`⚠️ Gemini [${keyLabel}] ${model} blocked due to safety, trying next...`);
          continue; // Try next model
        }
      }

      if (response.status === 404) {
        console.warn(`⚠️ Gemini Vision [${keyLabel}] model ${model} not found, trying next...`);
        continue;
      }

      if (response.status === 503) {
        console.warn(`⚠️ Gemini Vision [${keyLabel}] model ${model} overloaded, trying next...`);
        continue;
      }

      if (response.status === 429) {
        console.warn(`⚠️ Gemini Vision [${keyLabel}] rate limited on ${model}, trying next API key...`);
        break; // Break inner loop to try next API key
      }

      const errorText = await response.text();
      console.error(`Gemini Vision [${keyLabel}] API error with ${model}: ${response.status}`, errorText);
    } catch (error) {
      console.error(`Gemini Vision [${keyLabel}] ${model} failed:`, error.message);
    }
    }
  }
  
  // All Gemini API keys and models failed
  console.warn(`⚠️ All Gemini Vision API keys (${GEMINI_API_KEYS.length}) and models failed`);
  return { success: false, error: 'All Gemini API keys and models failed' };
}

/**
 * Generate content using Google Gemini API with OpenAI and Perplexity fallbacks
 * Fallback chain: All Gemini API keys → OpenAI → Perplexity
 */
export async function generateContent(prompt, systemInstruction = '') {
  if (GEMINI_API_KEYS.length === 0) {
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

  // Try each API key, then each model
  for (let keyIndex = 0; keyIndex < GEMINI_API_KEYS.length; keyIndex++) {
    const apiKey = GEMINI_API_KEYS[keyIndex];
    const keyLabel = keyIndex === 0 ? 'Primary' : `Fallback-${keyIndex}`;
    
    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Gemini [${keyLabel}] succeeded with model: ${model}`);
          return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        if (response.status === 404) {
          console.warn(`⚠️ Gemini [${keyLabel}] model ${model} not found, trying next...`);
          continue;
        }

        if (response.status === 503) {
          console.warn(`⚠️ Gemini [${keyLabel}] model ${model} overloaded, trying next...`);
          continue;
        }

        if (response.status === 429) {
          console.warn(`⚠️ Gemini [${keyLabel}] rate limited on ${model}, trying next API key...`);
          break; // Break inner loop to try next API key
        }

        const errorText = await response.text();
        console.error(`Gemini [${keyLabel}] API error with ${model}: ${response.status}`, errorText);
      } catch (error) {
        console.error(`Gemini [${keyLabel}] ${model} failed:`, error.message);
      }
    }
  }

  console.warn(`⚠️ All Gemini API keys (${GEMINI_API_KEYS.length}) and models failed, falling back to OpenAI...`);
  return generateOpenAIContent(prompt, systemInstruction);
}

/**
 * Generate content from text and images using AI Vision APIs
 * 
 * IMPORTANT: This function tries ALL images with each provider - NO screenshot skipping.
 * If one provider fails, it falls back to the next provider with the same full set of images.
 * 
 * Fallback chain: Gemini Vision → OpenAI Vision (gpt-4o) → Error
 * 
 * @param {string} prompt - The analysis prompt
 * @param {Array} images - Array of {data: base64, mimeType: string}
 * @returns {Promise<string>} - AI analysis result
 */
export async function generateVisionContent(prompt, images = []) {
  console.log(`[Vision] Starting analysis with ${images.length} images (NO screenshot skipping)`);
  
  // Try Gemini Vision first with ALL images
  if (GEMINI_API_KEY) {
    console.log('[Vision] Trying Gemini Vision with all images...');
    const geminiResult = await tryGeminiVision(prompt, images);
    
    if (geminiResult.success) {
      return geminiResult.text;
    }
    
    console.log('[Vision] Gemini failed:', geminiResult.error || 'unknown error');
  } else {
    console.log('[Vision] No Gemini API key, skipping to OpenAI...');
  }
  
  // Try OpenAI Vision as fallback with ALL images (no reduction)
  if (OPENAI_API_KEY) {
    console.log('[Vision] Trying OpenAI Vision with all', images.length, 'images...');
    try {
      const result = await generateOpenAIVisionContent(prompt, images);
      if (result && !isContentPolicyError(result)) {
        console.log('[Vision] OpenAI Vision succeeded with all images');
        return result;
      }
      console.log('[Vision] OpenAI Vision returned content policy error');
    } catch (openaiError) {
      console.error('[Vision] OpenAI Vision failed:', openaiError.message);
    }
  } else {
    console.log('[Vision] No OpenAI API key, cannot fallback...');
  }
  
  // All attempts failed - throw error (no fake data)
  console.error('❌ All vision AI attempts failed with', images.length, 'images');
  throw new Error('AI_VISION_FAILED: Unable to analyze screenshots. All AI services failed. Please try again later.');
}

/**
 * Fallback to OpenAI for vision/multimodal generation
 */
async function generateOpenAIVisionContent(prompt, images = []) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  console.log('🤖 Trying OpenAI Vision (gpt-4o)...');

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`,
            detail: 'low'
          }
        }))
      ]
    }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: messages,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`OpenAI Vision API error: ${response.status}`, errorText);
    throw new Error(`OpenAI Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content || '';
  console.log('✅ OpenAI Vision response received, length:', result.length);
  return result;
}

/**
 * Check which AI services are available
 */
export function getAIAvailability() {
  return {
    gemini: GEMINI_API_KEYS.length > 0,
    geminiKeyCount: GEMINI_API_KEYS.length,
    openai: !!OPENAI_API_KEY,
    perplexity: !!PERPLEXITY_API_KEY,
    anyAvailable: !!(GEMINI_API_KEYS.length > 0 || OPENAI_API_KEY || PERPLEXITY_API_KEY)
  };
}
