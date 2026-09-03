/** @jest-environment jsdom */

describe('whiteboard AI client', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('uses the cookie session without sending a Bearer null header', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
    const { requestWhiteboardAI } = require('@/lib/whiteboardAIClient');

    await requestWhiteboardAI('board 1', { action: 'chat', payload: { message: 'Hello' } });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/whiteboard/board%201/analyze',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', message: 'Hello' }),
      }),
    );
  });

  test('includes a real token and exposes the API error message', async () => {
    window.localStorage.setItem('token', 'valid-token');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'Access denied', details: 'viewer' }),
    });
    const { requestWhiteboardAI } = require('@/lib/whiteboardAIClient');

    await expect(requestWhiteboardAI('board-1', { action: 'clear' }))
      .rejects.toMatchObject({ message: 'Access denied', status: 403, details: 'viewer' });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer valid-token');
  });

  test('reports non-JSON server responses instead of throwing a JSON parse error', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 504,
      text: async () => '<html>timeout</html>',
    });
    const { requestWhiteboardAI } = require('@/lib/whiteboardAIClient');

    await expect(requestWhiteboardAI('board-1', { action: 'prepare' }))
      .rejects.toMatchObject({ message: 'MIRA request failed (504). Please try again.', status: 504 });
  });
});
