/**
 * Pollinations.ai Audio Helper
 * Text-to-speech and speech-to-text via Pollinations.ai's OpenAI-compatible
 * audio endpoints (POST /v1/audio/speech and /v1/audio/transcriptions).
 */

const DEFAULT_BASE_URL = (process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai/v1').replace(/\/$/, '');

/**
 * Get audio configuration at runtime so environment variables are read when
 * the function is called, not when the module is loaded.
 */
function getAudioConfig() {
  const apiKey = (process.env.POLLINATIONS_API_KEY || '').trim();
  const voice = process.env.POLLINATIONS_TTS_VOICE || 'nova';
  const ttsModel = process.env.POLLINATIONS_TTS_MODEL || 'tts-1';
  const sttModel = process.env.POLLINATIONS_STT_MODEL || 'whisper-large-v3';
  return { apiKey, voice, ttsModel, sttModel };
}

export function isAudioConfigured() {
  return Boolean(getAudioConfig().apiKey);
}

/**
 * Voice presets map to Pollinations TTS voices.
 */
export const VOICE_PRESETS = {
  default: { voice: 'nova' },
  urgent: { voice: 'onyx' },
  calm: { voice: 'alloy' },
};

/**
 * Generate speech audio from text using Pollinations.
 * @param {string} text - The text to convert to speech
 * @param {object} options - Optional settings
 * @returns {Promise<{success: boolean, audioBuffer?: ArrayBuffer, contentType?: string, error?: string}>}
 */
export async function generateSpeech(text, options = {}) {
  const config = getAudioConfig();

  if (!config.apiKey) {
    return { success: false, error: 'Pollinations API key not configured' };
  }

  const {
    voice = config.voice,
    preset = 'default',
    model = config.ttsModel,
    responseFormat = 'mp3',
  } = options;

  const resolvedVoice = VOICE_PRESETS[preset]?.voice || voice;

  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: resolvedVoice,
        response_format: responseFormat,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Pollinations TTS error: ${response.status} - ${errorText}`,
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
 * Transcribe an audio file using Pollinations (Whisper-compatible).
 * @param {Blob|File} file - Audio file blob
 * @param {object} options - Optional transcription settings
 * @returns {Promise<{success: boolean, text?: string, languageCode?: string, language?: string, raw?: object, error?: string}>}
 */
export async function transcribeAudio(file, options = {}) {
  const config = getAudioConfig();

  if (!config.apiKey) {
    return { success: false, error: 'Pollinations API key not configured' };
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
    formData.append('model', model);

    if (languageCode && languageCode !== 'auto') {
      formData.append('language', languageCode);
    }

    formData.append('file', file, file?.name || fileName);

    const response = await fetch(`${DEFAULT_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Pollinations transcription error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();

    return {
      success: true,
      text: String(data?.text || '').trim(),
      languageCode: data?.language || languageCode || 'auto',
      language: data?.language || languageCode || 'auto',
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to transcribe audio',
    };
  }
}

/**
 * Process message template with dynamic placeholders
 * @param {string} template - Message template with placeholders
 * @param {object} data - Data to replace placeholders
 * @returns {string} - Processed message
 */
export function processMessageTemplate(template, data) {
  const placeholders = {
    '{senderName}': data.senderName || 'Unknown',
    '{senderRole}': formatRole(data.senderRole) || 'Team Member',
    '{receiverName}': data.receiverName || 'Employee',
    '{receiverDepartment}': data.receiverDepartment || 'Your Department',
    '{companyName}': data.companyName || 'Organization',
    '{time}': new Date().toLocaleTimeString(),
    '{date}': new Date().toLocaleDateString()
  };

  let processedMessage = template;

  for (const [placeholder, value] of Object.entries(placeholders)) {
    processedMessage = processedMessage.replace(new RegExp(placeholder, 'g'), value);
  }

  return processedMessage;
}

/**
 * Format role for display
 * @param {string} role - Role string
 * @returns {string} - Formatted role
 */
function formatRole(role) {
  const roleMap = {
    'admin': 'Administrator',
    'hr': 'HR Manager',
    'manager': 'Manager',
    'employee': 'Team Member',
    'department_head': 'Department Head'
  };
  return roleMap[role] || role;
}

/**
 * Prebuilt message templates for quick alerts
 */
export const PREBUILT_MESSAGES = [
  {
    id: 'urgent_meeting',
    title: 'Urgent Meeting Request',
    template: 'Hello {receiverName}, this is {senderName}, your {senderRole}. Please join the urgent meeting immediately.',
    category: 'meeting',
    priority: 'urgent'
  },
  {
    id: 'immediate_contact',
    title: 'Immediate Contact Required',
    template: 'Hi {receiverName}, this is {senderName}. Please contact me immediately regarding an important matter.',
    category: 'contact',
    priority: 'high'
  },
  {
    id: 'task_deadline',
    title: 'Task Deadline Alert',
    template: '{receiverName}, this is a reminder from {senderName}. Your pending task requires immediate attention. Please complete it as soon as possible.',
    category: 'task',
    priority: 'high'
  },
  {
    id: 'office_presence',
    title: 'Office Presence Required',
    template: 'Attention {receiverName}, {senderName} here. Your presence is required at the office. Please report immediately.',
    category: 'attendance',
    priority: 'urgent'
  },
  {
    id: 'client_call',
    title: 'Client Call Alert',
    template: 'Hi {receiverName}, this is {senderName}. There\'s an important client waiting. Please be available for a call immediately.',
    category: 'client',
    priority: 'high'
  },
  {
    id: 'document_approval',
    title: 'Document Approval Needed',
    template: '{receiverName}, {senderName} here. An urgent document requires your approval. Please review and approve at your earliest convenience.',
    category: 'approval',
    priority: 'medium'
  },
  {
    id: 'team_assembly',
    title: 'Team Assembly',
    template: 'Attention team member {receiverName}. This is {senderName}. Please assemble at the designated meeting point immediately.',
    category: 'meeting',
    priority: 'urgent'
  },
  {
    id: 'system_issue',
    title: 'System Issue Alert',
    template: 'Alert for {receiverName}! {senderName} reporting a critical system issue. Your immediate assistance is required.',
    category: 'technical',
    priority: 'urgent'
  },
  {
    id: 'project_update',
    title: 'Project Update Required',
    template: 'Hi {receiverName}, this is {senderName}. Please provide an immediate status update on your current project.',
    category: 'project',
    priority: 'medium'
  },
  {
    id: 'general_announcement',
    title: 'General Announcement',
    template: 'Hello {receiverName}, this is an important announcement from {senderName}, your {senderRole}. Please check your notifications for details.',
    category: 'announcement',
    priority: 'medium'
  },
  {
    id: 'emergency_evacuation',
    title: 'Emergency Alert',
    template: 'EMERGENCY ALERT for {receiverName}! This is {senderName}. Please follow emergency procedures immediately.',
    category: 'emergency',
    priority: 'urgent'
  },
  {
    id: 'shift_change',
    title: 'Shift Change Notice',
    template: '{receiverName}, this is {senderName}. There\'s been a change in your shift schedule. Please contact HR for details.',
    category: 'schedule',
    priority: 'high'
  }
];

/**
 * Get message templates by category
 * @param {string} category - Category filter
 * @returns {Array} - Filtered templates
 */
export function getMessagesByCategory(category) {
  if (!category || category === 'all') {
    return PREBUILT_MESSAGES;
  }
  return PREBUILT_MESSAGES.filter(msg => msg.category === category);
}

/**
 * Get message template by ID
 * @param {string} id - Template ID
 * @returns {object|null} - Template or null
 */
export function getMessageById(id) {
  return PREBUILT_MESSAGES.find(msg => msg.id === id) || null;
}

export default {
  generateSpeech,
  generateSpeechBase64,
  transcribeAudio,
  processMessageTemplate,
  PREBUILT_MESSAGES,
  getMessagesByCategory,
  getMessageById,
  VOICE_PRESETS
};
