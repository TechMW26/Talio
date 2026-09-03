export class WhiteboardAIRequestError extends Error {
  constructor(message, status = 0, details = '') {
    super(message);
    this.name = 'WhiteboardAIRequestError';
    this.status = status;
    this.details = details;
  }
}

function getStoredToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage?.getItem('token')?.trim() || '';
}

async function readResponse(response) {
  const raw = await response.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new WhiteboardAIRequestError(
      response.ok
        ? 'MIRA returned an unreadable response. Please try again.'
        : `MIRA request failed (${response.status}). Please try again.`,
      response.status,
    );
  }
}

/**
 * Shared browser client for every whiteboard AI action. Cookie sessions remain
 * valid when localStorage has no token; an accidental `Bearer null` header no
 * longer masks the authentication cookie.
 */
export async function requestWhiteboardAI(boardId, options = {}) {
  const normalizedBoardId = String(boardId || '').trim();
  if (!normalizedBoardId) {
    throw new WhiteboardAIRequestError('Whiteboard is not ready yet. Please try again.');
  }

  const { action, payload = {}, method = action ? 'POST' : 'GET', signal } = options;
  const headers = {};
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const requestOptions = {
    method,
    headers,
    credentials: 'same-origin',
    signal,
  };

  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify({ action, ...payload });
  }

  let response;
  try {
    response = await fetch(`/api/whiteboard/${encodeURIComponent(normalizedBoardId)}/analyze`, requestOptions);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new WhiteboardAIRequestError('Unable to reach MIRA. Check your connection and try again.');
  }

  const data = await readResponse(response);
  if (!response.ok) {
    throw new WhiteboardAIRequestError(
      data.error || data.message || `MIRA request failed (${response.status}).`,
      response.status,
      data.details || '',
    );
  }

  return data;
}
