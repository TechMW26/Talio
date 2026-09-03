describe('whiteboard AI content normalization', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('normalizes recovered model content into a canvas-safe structure', () => {
    const { normalizePreparedWhiteboardContent } = require('@/lib/whiteboardAIContent');

    const content = normalizePreparedWhiteboardContent({
      sections: [
        {
          items: [' First item ', { text: 'Second item' }, null],
          summary: ' Useful summary ',
        },
        null,
      ],
      metadata: 'invalid',
    }, { templateType: 'mindmap', prompt: 'Improve onboarding' });

    expect(content.title).toBe('Mindmap: Improve onboarding');
    expect(content.templateType).toBe('mindmap');
    expect(content.sections).toEqual([
      expect.objectContaining({
        type: 'section',
        title: 'Section 1',
        items: ['First item', 'Second item'],
        summary: 'Useful summary',
      }),
    ]);
    expect(content.metadata).toEqual({});
  });

  test('rejects content that cannot create any visible section', () => {
    const { normalizePreparedWhiteboardContent } = require('@/lib/whiteboardAIContent');

    expect(() => normalizePreparedWhiteboardContent({ sections: [{ items: [] }] }))
      .toThrow('AI content did not include any usable sections');
  });
});
