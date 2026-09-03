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

    test('replaces bare ``**`` placeholders leaked into value positions with null', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = '{"title":**,"description":"Comprehensive plan","sections":[**,{"title":"Phase 1"}]}';

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.title).toBeNull();
        expect(parsed.description).toBe('Comprehensive plan');
        expect(parsed.sections).toEqual([null, { title: 'Phase 1' }]);
    });

    test('unwraps markdown-bold values like **Plan Title** into JSON strings', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = '{"title":**Comprehensive Project Plan**,"sections":[**Phase One**,**Phase Two**]}';

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.title).toBe('Comprehensive Project Plan');
        expect(parsed.sections).toEqual(['Phase One', 'Phase Two']);
    });

    test('preserves ** characters that appear inside legitimate string values', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = '{"title":"Use **bold** in markdown","note":"keep ** as-is"}';

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.title).toBe('Use **bold** in markdown');
        expect(parsed.note).toBe('keep ** as-is');
    });

    test('repairs unescaped quotes inside AI-generated item text', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = '{"title":"Hiring Plan","sections":[{"title":"Interview","items":["Use the "structured scorecard" method","Record evidence"]}],"conclusion":"Ready"}';

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.sections[0].items).toEqual([
            'Use the "structured scorecard" method',
            'Record evidence'
        ]);
    });

    test('repairs several malformed structures in one whiteboard response', () => {
        const { parseAIJsonResponse } = require('@/lib/aiJsonResponse');

        const response = `\`\`\`json
{
  "title": "Launch Plan"
  "sections": [
    {"title":"Discover","items":["Interview users" "Map the "current state" journey"]}
    {"title":"Deliver","items":["Ship pilot","Measure adoption",]}
  ],
  "conclusion":"Review weekly",
}
\`\`\``;

        const parsed = parseAIJsonResponse(response, { expectedRoot: 'object' });

        expect(parsed.title).toBe('Launch Plan');
        expect(parsed.sections).toHaveLength(2);
        expect(parsed.sections[0].items[1]).toBe('Map the "current state" journey');
        expect(parsed.sections[1].items).toEqual(['Ship pilot', 'Measure adoption']);
    });
});
