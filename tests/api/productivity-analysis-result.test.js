describe('productivity analysis result parser', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('preserves rich productivity fields from truncated custom AI JSON', () => {
        const { parseProductivityAnalysisResponse } = require('@/lib/productivityAnalysisResult');

        const truncatedResponse = `{
      "sessionTitle": "Profile Routing",
      "summary": "The session focused on profile setup and routing configuration inside the Kylas platform.",
      "score": 75,
      "focusScore": 70,
      "taskCompletionIndicators": 60,
      "timeDistribution": { "deepWork": 35, "collaboration": 10, "administrative": 25, "unfocused": 15, "idle": 15 },
      "focusMetrics": { "longestFocusStreak": "8 min", "contextSwitches": 6, "distractionCount": 3, "idleScreensDetected": 1 },
      "achievements": ["Configured routing rules", "Completed profile setup"],
      "suggestions": ["Reduce context switching", "Resolve capture issues earlier"],
      "insights": ["Profile setup was necessary but time-consuming.", "Kylas routing configuration is a core task."],
      "concerns": ["Screen capture issues may indicate a technical problem."],
      "redFlags": ["Potential distraction with ChatGPT"],
      "workCategories": [{ "category": "Development/Coding", "percentage": 45, "isActive": true }],
      "screenshotAnalysis": [{ "index": 0, "summary": "Kylas profile setup screen with routing options.", "activity": "document", "productivity": "high", "applicationVisible": "Chrome", "websiteVisible": "app.kylas.io", "isActiveWork": true, "concerns": "", "youtubeStatus": "not_applicable" }],
      "applications": [{ "name": "Chrome", "category": "browser", "estimatedMinutes": 8, "productivityImpact": "positive", "wasActivelyUsed": true }],
      "websites": [{ "domain": "app.kylas.io", "category": "work", "estimatedMinutes": 7, "wasActivelyViewed": true }],
      "taskRelativity": { "score": 70, "matchedTasks": ["Profile Setup"], "unrelatedActivities": ["Quick ChatGPT lookup"], "assessment": "Mostly aligned with assigned work." },
      "overallAssessment": { "genuineWorkPercentage": 85, "taskAlignmentPercentage": 70, "strengths": ["Active engagement with Kylas platform."], "majorConcerns": ["Screen capture issues during profile setup."], "areasForImprovement": ["Avoid unrelated tabs during setup."], "recommendation": "Address the screen capture issue and keep secondary tabs focused on work tasks`
        const result = parseProductivityAnalysisResponse(truncatedResponse);

        expect(result.score).toBe(75);
        expect(result.focusScore).toBe(70);
        expect(result.timeDistribution).toMatchObject({
            deepWork: 35,
            collaboration: 10,
            administrative: 25,
            unfocused: 15,
            idle: 15
        });
        expect(result.focusMetrics).toMatchObject({
            longestFocusStreak: '8 min',
            contextSwitches: 6,
            distractionCount: 3,
            idleScreensDetected: 1
        });
        expect(result.taskRelativity).toMatchObject({
            score: 70,
            matchedTasks: ['Profile Setup']
        });
        expect(result.applications[0]).toMatchObject({ name: 'Chrome', estimatedMinutes: 8 });
        expect(result.websites[0]).toMatchObject({ domain: 'app.kylas.io', estimatedMinutes: 7 });
        expect(result.screenshotAnalysis[0]).toMatchObject({
            applicationVisible: 'Chrome',
            websiteVisible: 'app.kylas.io'
        });
        expect(result.overallAssessment).toMatchObject({
            genuineWorkPercentage: 85,
            taskAlignmentPercentage: 70,
            strengths: ['Active engagement with Kylas platform.'],
            majorConcerns: ['Screen capture issues during profile setup.'],
            areasForImprovement: ['Avoid unrelated tabs during setup.']
        });
    });

    test('derives missing detailed sections from screenshot analysis when custom AI omits them', () => {
        const { parseProductivityAnalysisResponse } = require('@/lib/productivityAnalysisResult');

        const result = parseProductivityAnalysisResponse(JSON.stringify({
            summary: 'The employee worked mostly in Chrome and briefly switched to ChatGPT for assistance.',
            score: 72,
            suggestions: ['Stay in the primary workflow longer'],
            concerns: ['Brief distraction detected'],
            screenshotAnalysis: [
                {
                    index: 0,
                    summary: 'Chrome open on the Kylas application.',
                    activity: 'document',
                    productivity: 'high',
                    applicationVisible: 'Chrome',
                    websiteVisible: 'app.kylas.io',
                    isActiveWork: true,
                    concerns: '',
                    youtubeStatus: 'not_applicable'
                },
                {
                    index: 1,
                    summary: 'ChatGPT tab open for a quick lookup.',
                    activity: 'research',
                    productivity: 'low',
                    applicationVisible: 'Chrome',
                    websiteVisible: 'chatgpt.com',
                    isActiveWork: false,
                    concerns: 'Possible distraction',
                    youtubeStatus: 'not_applicable'
                }
            ]
        }));

        expect(result.timeDistribution).toBeTruthy();
        expect(result.focusMetrics).toBeTruthy();
        expect(result.workCategories.length).toBeGreaterThan(0);
        expect(result.applications[0]).toMatchObject({ name: 'Chrome' });
        expect(result.websites.map(site => site.domain)).toEqual(expect.arrayContaining(['app.kylas.io', 'chatgpt.com']));
        expect(result.overallAssessment).toMatchObject({
            genuineWorkPercentage: 72,
            areasForImprovement: ['Stay in the primary workflow longer']
        });
    });
});