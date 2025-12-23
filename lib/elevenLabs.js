/**
 * ElevenLabs Voice AI Helper
 * Generates speech from text using ElevenLabs API
 */

/**
 * Get ElevenLabs configuration at runtime
 * This ensures environment variables are read when the function is called,
 * not when the module is loaded (which can cause issues with Next.js)
 */
function getElevenLabsConfig() {
  // Server-side should use non-prefixed vars, fallback to NEXT_PUBLIC_ for compatibility
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || 'm7GHBtY0UEqljrKQw2JH';
  const apiUrl = process.env.ELEVENLABS_API_URL || process.env.NEXT_PUBLIC_ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1/text-to-speech/';
  
  // Debug logging for production troubleshooting
  console.log('[ElevenLabs Config] API Key present:', !!apiKey, '| Length:', apiKey?.length || 0);
  console.log('[ElevenLabs Config] Voice ID:', voiceId);
  console.log('[ElevenLabs Config] API URL:', apiUrl);
  
  return { apiKey, voiceId, apiUrl };
}

/**
 * Available voice settings presets
 */
export const VOICE_PRESETS = {
  default: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.5,
    use_speaker_boost: true
  },
  urgent: {
    stability: 0.3,
    similarity_boost: 0.8,
    style: 0.8,
    use_speaker_boost: true
  },
  calm: {
    stability: 0.8,
    similarity_boost: 0.6,
    style: 0.3,
    use_speaker_boost: false
  }
};

/**
 * Generate speech audio from text using ElevenLabs
 * @param {string} text - The text to convert to speech
 * @param {object} options - Optional settings
 * @returns {Promise<{success: boolean, audioBuffer?: ArrayBuffer, error?: string}>}
 */
export async function generateSpeech(text, options = {}) {
  // Get configuration at runtime to ensure env vars are available
  const config = getElevenLabsConfig();
  
  if (!config.apiKey) {
    console.error('[ElevenLabs] API key not configured. Check NEXT_PUBLIC_ELEVENLABS_API_KEY or ELEVENLABS_API_KEY in your .env file');
    return { success: false, error: 'ElevenLabs API key not configured' };
  }

  const {
    voiceId = config.voiceId,
    preset = 'default',
    modelId = 'eleven_multilingual_v2'
  } = options;

  const voiceSettings = VOICE_PRESETS[preset] || VOICE_PRESETS.default;

  try {
    console.log(`[ElevenLabs] Generating speech for text: "${text.substring(0, 50)}..."`);
    console.log(`[ElevenLabs] Using voice ID: ${voiceId}, API URL: ${config.apiUrl}`);

    const response = await fetch(`${config.apiUrl}${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': config.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ElevenLabs] API error:', response.status, errorText);
      return { 
        success: false, 
        error: `ElevenLabs API error: ${response.status} - ${errorText}` 
      };
    }

    const audioBuffer = await response.arrayBuffer();
    console.log('[ElevenLabs] Speech generated successfully, size:', audioBuffer.byteLength);

    return { 
      success: true, 
      audioBuffer,
      contentType: 'audio/mpeg'
    };

  } catch (error) {
    console.error('[ElevenLabs] Error generating speech:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to generate speech' 
    };
  }
}

/**
 * Generate speech and return as base64 encoded string
 * @param {string} text - The text to convert to speech
 * @param {object} options - Optional settings
 * @returns {Promise<{success: boolean, audioBase64?: string, error?: string}>}
 */
export async function generateSpeechBase64(text, options = {}) {
  const result = await generateSpeech(text, options);
  
  if (!result.success) {
    return result;
  }

  try {
    // Convert ArrayBuffer to base64
    const base64 = Buffer.from(result.audioBuffer).toString('base64');
    return {
      success: true,
      audioBase64: base64,
      audioDataUrl: `data:audio/mpeg;base64,${base64}`,
      contentType: 'audio/mpeg'
    };
  } catch (error) {
    console.error('[ElevenLabs] Error converting to base64:', error);
    return {
      success: false,
      error: 'Failed to convert audio to base64'
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
  processMessageTemplate,
  PREBUILT_MESSAGES,
  getMessagesByCategory,
  getMessageById,
  VOICE_PRESETS
};
