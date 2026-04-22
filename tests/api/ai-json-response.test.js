describe('AI JSON response parser', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('parses fenced JSON objects with malformed commas between array elements', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = `Here is the structured result:\n\n\`\`\`json
{
  "title": "Mindmap",
  "sections": [
    { "title": "Planning", "items": ["Scope", "Owners"] }
    { "title": "Delivery", "items": ["Milestones", "Risks"] }
  ],
  "conclusion": "Ready"
}
\`\`\``;

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.title).toBe('Mindmap');
        expect(parsed.sections).toHaveLength(2);
        expect(parsed.sections[1].title).toBe('Delivery');
    });

    test('repairs truncated object JSON by closing open structures', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = '{"title":"Mindmap","sections":[{"title":"Planning","items":["Scope","Owners"]}],"conclusion":"Ready"';

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.conclusion).toBe('Ready');
        expect(parsed.sections[0].items).toEqual(['Scope', 'Owners']);
    });

    test('parses array-root responses with trailing commas', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = '```json\n[{"id":"1","type":"text",},{"id":"2","type":"sticky"}]\n```';

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'array' });

        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(2);
        expect(parsed[1].type).toBe('sticky');
    });

    test('repairs multiple missing commas in nested flowchart-style content', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = `{
    "title": "User Journey Flow",
    "sections": [
        {
            "title": "Start",
            "items": [
                "Open app"
                "Enter credentials"
                "Click sign in"
            ]
        }
        {
            "title": "Decision",
            "items": [
                "Validate user"
                "Branch by role"
            ]
        }
    ],
    "conclusion": "Flow complete"
}`;

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.sections).toHaveLength(2);
        expect(parsed.sections[0].items).toEqual(['Open app', 'Enter credentials', 'Click sign in']);
        expect(parsed.sections[1].title).toBe('Decision');
    });
});