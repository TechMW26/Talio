const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Models to try in order of preference
const GEMINI_MODELS = [
  'gemini-3.0-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro', 
  'gemini-pro'
];

/**
 * Fallback to OpenAI for text generation
 */
async function generateOpenAIContent(prompt, systemInstruction = '') {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured for fallback');
  }

  console.log('Falling back to OpenAI (gpt-4o-mini)...');
  
  const url = 'https://api.openai.com/v1/chat/completions';
  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemInstruction || 'You are a helpful AI assistant.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Fallback to OpenAI for vision/multimodal generation
 */
async function generateOpenAIVisionContent(prompt, images = []) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured for fallback');
  }

  console.log('Falling back to OpenAI Vision (gpt-4o-mini)...');

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`
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
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Vision API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Generate content using Google Gemini API with OpenAI fallback
 * @param {string} prompt - The user prompt
 * @param {string} [systemInstruction] - Optional system instruction
 * @returns {Promise<string>} - The generated text
 */
export async function generateContent(prompt, systemInstruction = '') {
  // Try OpenAI directly if Gemini key is missing
  if (!GEMINI_API_KEY) {
    if (OPENAI_API_KEY) return generateOpenAIContent(prompt, systemInstruction);
    console.error('GEMINI_API_KEY is not configured');
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

  // Try each Gemini model
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

      // 404 = model not found, try next model
      if (response.status === 404) {
        console.warn(`⚠️ Gemini model ${model} not found (404), trying next...`);
        continue;
      }

      // 503 = service unavailable (overloaded), try next model
      if (response.status === 503) {
        console.warn(`⚠️ Gemini model ${model} overloaded (503), trying next...`);
        continue;
      }

      // 429 = rate limit, fall back to OpenAI
      if (response.status === 429 && OPENAI_API_KEY) {
        console.warn(`⚠️ Gemini rate limited (429), falling back to OpenAI...`);
        return generateOpenAIContent(prompt, systemInstruction);
      }

      const errorText = await response.text();
      console.error(`Gemini API error with ${model}: ${response.status}`, errorText);
    } catch (error) {
      console.error(`Gemini ${model} failed:`, error.message);
    }
  }

  // All Gemini models failed, try OpenAI
  if (OPENAI_API_KEY) {
    console.warn('⚠️ All Gemini models failed, falling back to OpenAI...');
    return generateOpenAIContent(prompt, systemInstruction);
  }

  throw new Error('All AI models failed');
}

/**
 * Generate content from text and images using Google Gemini API with OpenAI fallback
 * @param {string} prompt - The text prompt
 * @param {Array<{mimeType: string, data: string}>} images - Array of base64 images (without prefix)
 * @returns {Promise<string>} - The generated text
 */
export async function generateVisionContent(prompt, images = []) {
  // Try OpenAI directly if Gemini key is missing
  if (!GEMINI_API_KEY) {
    if (OPENAI_API_KEY) return generateOpenAIVisionContent(prompt, images);
    console.error('GEMINI_API_KEY is not configured');
    throw new Error('AI service is not configured');
  }

  const parts = [];
  
  // Add images first
  images.forEach(img => {
    parts.push({
      inline_data: {
        mime_type: img.mimeType || 'image/png',
        data: img.data
      }
    });
  });
  
  // Add text prompt
  parts.push({ text: prompt });

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1000
    }
  };

  // Try each Gemini model
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
        console.log(`✅ Gemini Vision succeeded with model: ${model}`);
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      // 404 = model not found, try next model
      if (response.status === 404) {
        console.warn(`⚠️ Gemini Vision model ${model} not found (404), trying next...`);
        continue;
      }

      // 429 = rate limit, fall back to OpenAI
      if (response.status === 429 && OPENAI_API_KEY) {
        console.warn(`⚠️ Gemini Vision rate limited (429), falling back to OpenAI...`);
        return generateOpenAIVisionContent(prompt, images);
      }

      const errorText = await response.text();
      console.error(`Gemini Vision API error with ${model}: ${response.status}`, errorText);
    } catch (error) {
      console.error(`Gemini Vision ${model} failed:`, error.message);
    }
  }

  // All Gemini models failed, try OpenAI
  if (OPENAI_API_KEY) {
    console.warn('⚠️ All Gemini Vision models failed, falling back to OpenAI...');
    return generateOpenAIVisionContent(prompt, images);
  }

  throw new Error('All AI Vision models failed');
}
