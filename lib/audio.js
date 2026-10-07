/**
 * ElevenLabs Audio Helper
 * Text-to-speech and speech-to-text via ElevenLabs native endpoints.
 */

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1';
// MIRA's default ElevenLabs voice. Deployments may override this with
// ELEVENLABS_VOICE_ID without requiring a code change.
export const DEFAULT_MIRA_ELEVENLABS_VOICE_ID = 'jJ0Hr51MaPgsgfPtFdR4';

export function getMiraElevenLabsVoiceId() {
  return (process.env.ELEVENLABS_VOICE_ID || DEFAULT_MIRA_ELEVENLABS_VOICE_ID).trim();
}

/**
 * Get audio configuration at runtime so environment variables are read when
 * the function is called, not when the module is loaded.
 */
function getAudioConfig() {
  const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  const voice = getMiraElevenLabsVoiceId();
  const ttsModel = 'eleven_v4';
  const sttModel = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
  return { apiKey, voice, ttsModel, sttModel };
}

export function isAudioConfigured() {
  return Boolean(getAudioConfig().apiKey);
}

/**
 * Voice presets map to ElevenLabs TTS voices.
 */
export const VOICE_PRESETS = {
  default: {},
  urgent: {},
  calm: {},
};

/**
 * Generate speech audio from text using ElevenLabs.
 * @param {string} text - The text to convert to speech
 * @param {object} options - Optional settings
 * @returns {Promise<{success: boolean, audioBuffer?: ArrayBuffer, contentType?: string, error?: string}>}
 */
export async function generateSpeech(text, options = {}) {
  const config = getAudioConfig();

  if (!config.apiKey) {
    return { success: false, error: 'ElevenLabs API key not configured' };
  }

  const {
    voice = config.voice,
    preset = 'default',
    model = config.ttsModel,
  } = options;

  const resolvedVoice = VOICE_PRESETS[preset]?.voice || voice;
  if (!resolvedVoice) return { success: false, error: 'ElevenLabs voice is not configured' };

  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/text-to-speech/${encodeURIComponent(resolvedVoice)}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      signal: AbortSignal.timeout(55000),
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.apiKey,
      },
      body: JSON.stringify({
        model_id: model,
        text,
        apply_text_normalization: 'on',
      }),
    });

    if (!response.ok) {
      await response.body?.cancel();
      return {
        success: false,
        error: `ElevenLabs TTS error: ${response.status}`,
      };
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      success: true,
      audioBuffer,
      contentType: 'audio/mpeg',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to generate speech',
    };
  }
}

/**
 * Generate speech and return as base64 encoded string.
 * @param {string} text - The text to convert to speech
 * @param {object} options - Optional settings
 * @returns {Promise<{success: boolean, audioBase64?: string, audioDataUrl?: string, error?: string}>}
 */
export async function generateSpeechBase64(text, options = {}) {
  const result = await generateSpeech(text, options);

  if (!result.success) {
    return result;
  }

  try {
    const base64 = Buffer.from(result.audioBuffer).toString('base64');
    return {
      success: true,
      audioBase64: base64,
      audioDataUrl: `data:${result.contentType || 'audio/mpeg'};base64,${base64}`,
      contentType: result.contentType || 'audio/mpeg',
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to convert audio to base64',
    };
  }
}

/**
 * Transcribe an audio file using ElevenLabs Scribe.
 * @param {Blob|File} file - Audio file blob
 * @param {object} options - Optional transcription settings
 * @returns {Promise<{success: boolean, text?: string, languageCode?: string, language?: string, raw?: object, error?: string}>}
 */
export async function transcribeAudio(file, options = {}) {
  const config = getAudioConfig();

  if (!config.apiKey) {
    return { success: false, error: 'ElevenLabs API key not configured' };
  }

  if (!file) {
    return { success: false, error: 'No audio file provided for transcription' };
  }

  const {
    languageCode,
    fileName = 'meeting-segment.webm',
    model = config.sttModel,
  } = options;

  try {
    const formData = new FormData();
    formData.append('model_id', model);

    if (languageCode && languageCode !== 'auto') {
      formData.append('language_code', languageCode);
    }

    formData.append('file', file, file?.name || fileName);

    const response = await fetch(`${DEFAULT_BASE_URL}/speech-to-text`, {
      method: 'POST',
      signal: AbortSignal.timeout(55000),
      headers: {
        'xi-api-key': config.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      await response.body?.cancel();
      return {
        success: false,
        error: `ElevenLabs transcription error: ${response.status}`,
      };
    }

    const data = await response.json();

    return {
      success: true,
      text: String(data?.text || '').trim(),
      languageCode: data?.language_code || languageCode || 'auto',
      language: data?.language_code || languageCode || 'auto',
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to transcribe audio',
    };
  }
}

export default {
  generateSpeech,
  generateSpeechBase64,
  transcribeAudio,
  VOICE_PRESETS,
  DEFAULT_MIRA_ELEVENLABS_VOICE_ID,
  getMiraElevenLabsVoiceId,
};
