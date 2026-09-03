jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(data, init = {}) {
      const headers = new Headers(init.headers || {});
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      return new MockNextResponse(JSON.stringify(data), {
        ...init,
        headers,
        status: init.status || 200,
      });
    }
  }

  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }));
jest.mock('@/lib/promptEngine', () => ({ generateSmartContent: jest.fn() }));
jest.mock('@/lib/gemini', () => ({
  generateContent: jest.fn(),
  generateVisionContent: jest.fn(),
}));
jest.mock('@/lib/imageCompression', () => ({ compressScreenshot: jest.fn() }));

const { getAuthAndModels } = require('@/lib/auth');
const { generateSmartContent } = require('@/lib/promptEngine');
const { POST } = require('@/app/api/whiteboard/[id]/analyze/route');

describe('whiteboard AI route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prepares usable content from malformed model JSON without retrying', async () => {
    const whiteboard = {
      pages: [{ id: 'page-1', objects: [] }],
      aiAnalysis: { summary: '', messages: [], notes: [], keyPoints: [] },
      getUserPermission: jest.fn(() => 'owner'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const Whiteboard = { findById: jest.fn().mockResolvedValue(whiteboard) };

    getAuthAndModels.mockResolvedValue({
      success: true,
      user: { _id: 'user-1' },
      models: { Whiteboard },
    });
    generateSmartContent.mockResolvedValue(
      '{"title":"Hiring map" "sections":[{"title":"Interview","items":["Use the "structured scorecard" method" "Record evidence"]}],"conclusion":"Proceed"}',
    );

    const response = await POST(new Request('http://localhost/api/whiteboard/board-1/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', message: 'Improve hiring', templateType: 'mindmap' }),
    }), { params: Promise.resolve({ id: 'board-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.content.sections[0].items).toEqual([
      'Use the "structured scorecard" method',
      'Record evidence',
    ]);
    expect(generateSmartContent).toHaveBeenCalledTimes(1);
    expect(whiteboard.save).toHaveBeenCalledTimes(1);
  });

  test('restructures only the requested active page', async () => {
    const whiteboard = {
      pages: [
        { id: 'page-1', objects: [{ id: 'first', type: 'text', text: 'Keep me', x: 1, y: 1 }] },
        { id: 'page-2', objects: [{ id: 'second', type: 'text', text: 'Move me', x: 13, y: 29 }] },
      ],
      aiAnalysis: { summary: '', messages: [], notes: [], keyPoints: [] },
      getUserPermission: jest.fn(() => 'owner'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const Whiteboard = { findById: jest.fn().mockResolvedValue(whiteboard) };

    getAuthAndModels.mockResolvedValue({
      success: true,
      user: { _id: 'user-1' },
      models: { Whiteboard },
    });
    generateSmartContent.mockResolvedValue('[{"id":"second","type":"text","text":"Move me","x":40,"y":60}]');

    const response = await POST(new Request('http://localhost/api/whiteboard/board-1/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restructure', targetPageIndex: 1 }),
    }), { params: Promise.resolve({ id: 'board-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pages[0].objects[0].id).toBe('first');
    expect(body.pages[1].objects).toEqual([
      expect.objectContaining({ id: 'second', x: 40, y: 60 }),
    ]);
  });
});
