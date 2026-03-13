import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { generateContent, generateVisionContent } from '@/lib/gemini';
import { generateSmartContent } from '@/lib/promptEngine';

export const maxDuration = 60;

// Convert canvas objects to a text description for AI
function describeCanvasObjects(pages) {
  const descriptions = [];

  // Safe check for pages array
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return '';
  }

  pages.forEach((page, pageIndex) => {
    // Safe check for page objects
    if (!page || !page.objects || !Array.isArray(page.objects) || page.objects.length === 0) return;

    descriptions.push(`\n--- Page ${pageIndex + 1} ---`);

    page.objects.forEach((obj, index) => {
      if (!obj || !obj.type) return;

      let desc = '';

      // Safe accessors for coordinates with defaults
      const safeX = Math.round(obj.x ?? 0);
      const safeY = Math.round(obj.y ?? 0);
      const safeWidth = Math.round(obj.width ?? 0);
      const safeHeight = Math.round(obj.height ?? 0);

      switch (obj.type) {
        case 'text':
          desc = `Text: "${obj.text || ''}" at position (${safeX}, ${safeY})`;
          break;
        case 'sticky':
          desc = `Sticky Note: "${obj.text || ''}" - Color: ${obj.fillColor || 'yellow'} at (${safeX}, ${safeY}), size: ${obj.width ? Math.round(obj.width) : 200}x${obj.height ? Math.round(obj.height) : 200}`;
          break;
        case 'rect':
          desc = `Rectangle at (${safeX}, ${safeY}), size: ${safeWidth}x${safeHeight}, fill: ${obj.fillColor || 'none'}`;
          break;
        case 'ellipse':
          desc = `Ellipse/Circle at (${safeX}, ${safeY}), size: ${safeWidth}x${safeHeight}`;
          break;
        case 'diamond':
          desc = `Diamond shape at (${safeX}, ${safeY})`;
          break;
        case 'triangle':
          desc = `Triangle at (${safeX}, ${safeY})`;
          break;
        case 'star':
          desc = `Star shape at (${safeX}, ${safeY})`;
          break;
        case 'hexagon':
          desc = `Hexagon at (${safeX}, ${safeY})`;
          break;
        case 'pentagon':
          desc = `Pentagon at (${safeX}, ${safeY})`;
          break;
        case 'line':
          if (obj.points && Array.isArray(obj.points) && obj.points.length >= 2) {
            const startPoint = obj.points[0] || { x: 0, y: 0 };
            const endPoint = obj.points[obj.points.length - 1] || { x: 0, y: 0 };
            desc = `Line from (${Math.round(startPoint.x ?? 0)}, ${Math.round(startPoint.y ?? 0)}) to (${Math.round(endPoint.x ?? 0)}, ${Math.round(endPoint.y ?? 0)})`;
          }
          break;
        case 'arrow':
          if (obj.points && Array.isArray(obj.points) && obj.points.length >= 2) {
            const startPoint = obj.points[0] || { x: 0, y: 0 };
            const endPoint = obj.points[obj.points.length - 1] || { x: 0, y: 0 };
            desc = `Arrow pointing from (${Math.round(startPoint.x ?? 0)}, ${Math.round(startPoint.y ?? 0)}) to (${Math.round(endPoint.x ?? 0)}, ${Math.round(endPoint.y ?? 0)})`;
          }
          break;
        case 'pencil':
        case 'highlighter':
          if (obj.points && Array.isArray(obj.points) && obj.points.length > 0) {
            desc = `${obj.type === 'highlighter' ? 'Highlighted' : 'Drawn'} path with ${obj.points.length} points, color: ${obj.strokeColor || 'black'}`;
          }
          break;
        case 'image':
          desc = `Image at (${safeX}, ${safeY}), size: ${safeWidth}x${safeHeight}`;
          break;
        default:
          desc = `${obj.type} element at (${safeX}, ${safeY})`;
      }

      if (desc) {
        descriptions.push(`  ${index + 1}. ${desc}`);
      }
    });
  });

  return descriptions.join('\n');
}

// Analyze layout patterns from existing objects
function analyzeLayout(objects) {
  // Safe check for objects array
  if (!objects || !Array.isArray(objects) || objects.length === 0) {
    return {
      hasContent: false,
      pattern: 'empty',
      bounds: { minX: 100, minY: 100, maxX: 100, maxY: 100 },
      gridInfo: null,
      colorScheme: [],
      avgElementSize: { width: 200, height: 150 },
      spacing: { horizontal: 60, vertical: 50 }
    };
  }

  // Calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const positions = [];
  const colors = new Set();
  let totalWidth = 0, totalHeight = 0, shapeCount = 0;

  objects.forEach(obj => {
    if (!obj) return;

    if (obj.fillColor && obj.fillColor !== 'transparent') colors.add(obj.fillColor);
    if (obj.strokeColor) colors.add(obj.strokeColor);

    if (obj.x !== undefined && obj.y !== undefined) {
      const w = obj.width || 100;
      const h = obj.height || 100;
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
      maxX = Math.max(maxX, obj.x + w);
      maxY = Math.max(maxY, obj.y + h);
      positions.push({ x: obj.x, y: obj.y, cx: obj.x + w / 2, cy: obj.y + h / 2, w, h, type: obj.type });
      totalWidth += w;
      totalHeight += h;
      shapeCount++;
    }
    if (obj.points?.length) {
      obj.points.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });
    }
  });

  if (minX === Infinity) minX = 100;
  if (minY === Infinity) minY = 100;
  if (maxX === -Infinity) maxX = 500;
  if (maxY === -Infinity) maxY = 500;

  // Detect layout pattern
  let pattern = 'freeform';
  const xCoords = positions.map(p => p.cx).sort((a, b) => a - b);
  const yCoords = positions.map(p => p.cy).sort((a, b) => a - b);

  // Check for columns (similar x values)
  const xGroups = [];
  let currentGroup = [xCoords[0]];
  for (let i = 1; i < xCoords.length; i++) {
    if (Math.abs(xCoords[i] - xCoords[i - 1]) < 80) {
      currentGroup.push(xCoords[i]);
    } else {
      if (currentGroup.length > 1) xGroups.push(currentGroup);
      currentGroup = [xCoords[i]];
    }
  }
  if (currentGroup.length > 1) xGroups.push(currentGroup);

  // Check for rows (similar y values)
  const yGroups = [];
  currentGroup = [yCoords[0]];
  for (let i = 1; i < yCoords.length; i++) {
    if (Math.abs(yCoords[i] - yCoords[i - 1]) < 60) {
      currentGroup.push(yCoords[i]);
    } else {
      if (currentGroup.length > 1) yGroups.push(currentGroup);
      currentGroup = [yCoords[i]];
    }
  }
  if (currentGroup.length > 1) yGroups.push(currentGroup);

  // Determine pattern
  if (xGroups.length >= 2 && yGroups.length >= 2) {
    pattern = 'grid';
  } else if (xGroups.length >= 2) {
    pattern = 'columns';
  } else if (yGroups.length >= 2) {
    pattern = 'rows';
  } else if (positions.length >= 3) {
    // Check for radial/mindmap pattern
    const centerX = (maxX + minX) / 2;
    const centerY = (maxY + minY) / 2;
    const centerCount = positions.filter(p =>
      Math.abs(p.cx - centerX) < 150 && Math.abs(p.cy - centerY) < 150
    ).length;
    if (centerCount >= 1 && positions.length > centerCount) {
      pattern = 'radial';
    }
  }

  // Calculate common spacing
  let avgHGap = 0, avgVGap = 0, gapCount = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = Math.abs(positions[j].x - (positions[i].x + positions[i].w));
      const dy = Math.abs(positions[j].y - (positions[i].y + positions[i].h));
      if (dx > 0 && dx < 300) { avgHGap += dx; gapCount++; }
      if (dy > 0 && dy < 200) { avgVGap += dy; gapCount++; }
    }
  }
  if (gapCount > 0) {
    avgHGap = Math.round(avgHGap / gapCount) || 40;
    avgVGap = Math.round(avgVGap / gapCount) || 40;
  } else {
    avgHGap = 40;
    avgVGap = 40;
  }

  return {
    hasContent: true,
    pattern,
    bounds: { minX, minY, maxX, maxY },
    width: maxX - minX,
    height: maxY - minY,
    objectCount: objects.length,
    colorScheme: Array.from(colors),
    avgElementSize: {
      width: shapeCount > 0 ? Math.round(totalWidth / shapeCount) : 200,
      height: shapeCount > 0 ? Math.round(totalHeight / shapeCount) : 150
    },
    spacing: { horizontal: avgHGap, vertical: avgVGap },
    columns: xGroups.length,
    rows: yGroups.length,
    positions
  };
}

// Clean AI response - remove markdown formatting, emojis, and special characters
function cleanAIResponse(text) {
  return text
    // Remove markdown headers
    .replace(/#{1,6}\s*/g, '')
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    // Remove bullet point characters but keep the text
    .replace(/^[\s]*[-•*]\s*/gm, '')
    // Remove numbered list markers but keep text
    .replace(/^[\s]*\d+\.\s*/gm, '')
    // Remove emojis
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove extra whitespace and normalize line breaks
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// POST - Analyze canvas or continue chat
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard } = models

    const { id } = await params;
    const body = await request.json();
    const { action, message, canvasScreenshot } = body;

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Check permission
    const permission = whiteboard.getUserPermission(user._id || user.userId);
    if (!permission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Initialize aiAnalysis if not exists
    if (!whiteboard.aiAnalysis) {
      whiteboard.aiAnalysis = { summary: '', messages: [], notes: [], keyPoints: [] };
    }

    if (action === 'analyze') {
      // Generate canvas description
      const canvasDescription = describeCanvasObjects(whiteboard.pages);

      if (!canvasDescription || canvasDescription.trim() === '') {
        return NextResponse.json({
          error: 'Canvas is empty. Add some content to analyze.'
        }, { status: 400 });
      }

      // Use vision API if screenshot is provided for deeper visual understanding
      const hasScreenshot = canvasScreenshot && canvasScreenshot.length > 100;

      const prompt = `You are MIRA, an insightful AI assistant analyzing a collaborative whiteboard. ${hasScreenshot ? 'You can see the actual canvas screenshot for visual context.' : ''} Look at the canvas contents and provide genuine, thoughtful analysis like a knowledgeable colleague would.

Canvas Elements:
${canvasDescription}

Provide your analysis as natural, flowing prose without any markdown formatting, bullet points, asterisks, dashes, emojis, or special characters. Write in a conversational but professional tone.

Focus on:
${hasScreenshot ? '- What you can actually SEE in the canvas image - the visual layout, colors, design choices, and overall composition' : ''}
What this whiteboard seems to be about and what the creator is working on
The relationships and connections between different elements
Any patterns or themes you notice
Thoughtful observations that might help the creator think more deeply about their work
Practical suggestions that could enhance or extend their ideas

Be genuinely helpful and insightful rather than just describing what you see. Share perspectives that add value.`;

      // Use vision API if screenshot provided, otherwise text-only API
      let summary;
      if (hasScreenshot) {
        const base64Data = canvasScreenshot.replace(/^data:image\/\w+;base64,/, '');
        summary = await generateVisionContent(prompt, [{ mimeType: 'image/png', data: base64Data }]);
      } else {
        // Use Smart Content for text-only analysis to get better human-like responses
        summary = await generateSmartContent(prompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-analyze',
          metadata: { whiteboardId: id },
          skipRefinement: true // Prompt is already highly structured
        });
      }
      summary = cleanAIResponse(summary);

      // Update the whiteboard with the new analysis
      whiteboard.aiAnalysis.summary = summary;
      whiteboard.aiAnalysis.lastAnalyzedAt = new Date();
      whiteboard.aiAnalysis.messages.push(
        { role: 'user', content: 'Analyze this canvas', timestamp: new Date() },
        { role: 'assistant', content: summary, timestamp: new Date() }
      );

      await whiteboard.save();

      return NextResponse.json({
        success: true,
        summary,
        aiAnalysis: whiteboard.aiAnalysis
      });

    } else if (action === 'chat') {
      // Continue conversation with context
      if (!message || !message.trim()) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }

      // Build conversation context
      const canvasDescription = describeCanvasObjects(whiteboard.pages);
      const previousMessages = whiteboard.aiAnalysis.messages.slice(-10).map(m =>
        `${m.role === 'user' ? 'User' : 'MIRA'}: ${m.content}`
      ).join('\n\n');

      // Check if screenshot was provided for visual context
      const hasScreenshot = canvasScreenshot && canvasScreenshot.length > 100;

      const context = `You are MIRA, an insightful AI assistant helping with a collaborative whiteboard. ${hasScreenshot ? 'You can see the actual canvas screenshot for visual understanding.' : ''} Respond naturally without any markdown formatting, bullet points, asterisks, dashes, numbered lists, emojis, or special characters. Write in flowing prose like a helpful colleague.

Canvas Contents:
${canvasDescription}

Previous Conversation:
${previousMessages}

Current understanding: ${whiteboard.aiAnalysis.summary || 'Not yet analyzed'}`;

      const prompt = `User: ${message}

${hasScreenshot ? 'I can see your canvas now. ' : ''}Respond helpfully and naturally. If sharing multiple points, weave them into coherent paragraphs rather than lists. Be insightful and add genuine value to the conversation.`;

      let response;
      if (hasScreenshot) {
        const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
        const base64Data = canvasScreenshot.replace(/^data:image\/\w+;base64,/, '');
        response = await generateVisionContent(fullPrompt, [{ mimeType: 'image/png', data: base64Data }]);
      } else {
        // Use Smart Content for chat to handle crude user inputs better
        response = await generateSmartContent(message, {
          userId: user._id || user.userId,
          feature: 'whiteboard-chat',
          systemInstruction: context,
          metadata: { whiteboardId: id }
        });
      }
      response = cleanAIResponse(response);

      // Save the new messages
      whiteboard.aiAnalysis.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: response, timestamp: new Date() }
      );

      // Extract notes/key points if requested
      if (message.toLowerCase().includes('note') || message.toLowerCase().includes('point') || message.toLowerCase().includes('key')) {
        // Try to extract sentences as key points
        const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 20);
        if (sentences.length > 0) {
          whiteboard.aiAnalysis.keyPoints = [
            ...new Set([
              ...(whiteboard.aiAnalysis.keyPoints || []),
              ...sentences.slice(0, 5).map(s => s.trim())
            ])
          ].slice(0, 20); // Keep max 20 points
        }
      }

      await whiteboard.save();

      return NextResponse.json({
        success: true,
        response,
        aiAnalysis: whiteboard.aiAnalysis
      });

    } else if (action === 'clear') {
      // Clear AI analysis history
      whiteboard.aiAnalysis = { summary: '', messages: [], notes: [], keyPoints: [] };
      await whiteboard.save();

      return NextResponse.json({
        success: true,
        message: 'AI analysis cleared',
        aiAnalysis: whiteboard.aiAnalysis
      });

    } else if (action === 'generate') {
      // Agent mode - generate canvas objects based on user request
      if (!message || !message.trim()) {
        return NextResponse.json({ error: 'Content description is required' }, { status: 400 });
      }

      // Get existing canvas content for deep context analysis
      const existingObjects = whiteboard.pages[0]?.objects || [];
      const layout = analyzeLayout(existingObjects);
      const existingCanvasDescription = describeCanvasObjects(whiteboard.pages);

      // Check conversation history for continuation context
      const recentMessages = whiteboard.aiAnalysis.messages.slice(-6);
      const isContination = message.toLowerCase().includes('continue') ||
        message.toLowerCase().includes('more') ||
        message.toLowerCase().includes('next');

      // Build a rich context about the existing design
      let designContext = '';
      if (layout.hasContent) {
        designContext = `
EXISTING CANVAS STATE (${layout.objectCount} elements):
${existingCanvasDescription}

LAYOUT ANALYSIS:
- Pattern: ${layout.pattern}
- Bounds: (${Math.round(layout.bounds.minX)}, ${Math.round(layout.bounds.minY)}) to (${Math.round(layout.bounds.maxX)}, ${Math.round(layout.bounds.maxY)})
- Element Sizes: ~${layout.avgElementSize.width}x${layout.avgElementSize.height}px
- Spacing: ~${layout.spacing.horizontal}px horizontal, ~${layout.spacing.vertical}px vertical
- Colors: ${layout.colorScheme.slice(0, 5).join(', ') || 'various pastels'}`;
      } else {
        designContext = 'The canvas is EMPTY. Start fresh at position (100, 100).';
      }

      // Dynamically calculate safe starting position
      const safeStartX = Math.round(layout.bounds.maxX ? layout.bounds.maxX + 80 : 100);
      const safeStartY = Math.round(layout.bounds.minY || 100);

      // Extract any structured content from the user's message (lists, sections, etc.)
      const contentAnalysis = `
USER REQUEST: "${message}"

POSITIONING STRATEGY:
- Safe starting X: ${safeStartX}
- Safe starting Y: ${safeStartY}
- Use a GRID SYSTEM: columns at x=100, 320, 540, 760... (220px apart)
- Rows at y=100, 260, 420, 580... (160px apart for sticky notes with auto-height)
- NEVER place anything at x < ${Math.round(layout.bounds.maxX || 0) + 40} if content exists`;

      // Check if this is a template-based generation
      const templateType = body.templateType || null;
      let templateInstructions = '';

      if (templateType === 'mindmap') {
        templateInstructions = `
🧠 MINDMAP TEMPLATE - CREATE A RADIAL THOUGHT MAP:
1. Create CENTRAL NODE: Large ellipse (width: 200, height: 100) with main topic at center (x: 400, y: 300)
2. Create PRIMARY BRANCHES: 4-6 ellipses around center, connected with curved arrows
3. Create SECONDARY NODES: Sticky notes branching from primary nodes
4. CONNECTIONS: Use curved arrows (arrowType: "curved") radiating outward
5. COLOR CODE: Each branch has its own color family
6. Layout: Radial from center - spread nodes 150-200px apart`;
      } else if (templateType === 'flowchart') {
        templateInstructions = `
📊 FLOWCHART TEMPLATE - CREATE A PROCESS FLOW:
1. START: Ellipse at top (y: 100)
2. PROCESS STEPS: Rectangles flowing downward, connected by straight arrows
3. DECISIONS: Diamond shapes with Yes/No branches using elbow arrows
4. END: Ellipse at bottom
5. CONNECTIONS: Straight arrows for linear flow, elbow arrows for branches
6. Layout: Top-to-bottom, decision branches go left/right
7. Add text labels on arrows for decision outcomes (Yes/No)`;
      } else if (templateType === 'planning') {
        templateInstructions = `
📋 PLANNING/KANBAN TEMPLATE - CREATE ORGANIZED COLUMNS:
1. COLUMN HEADERS: Text elements at y=80 ("To Do" at x=100, "In Progress" at x=350, "Done" at x=600)
2. COLUMN BACKGROUNDS: Large transparent rectangles (width: 220, height: 500) with dashed borders
3. TASK CARDS: Sticky notes inside each column (width: 180, height varies by content)
4. PRIORITY COLORS: Pink/Red=Urgent, Yellow=Normal, Green=Completed
5. DEPENDENCIES: Dotted arrows between related tasks
6. Layout: 3-4 columns side by side with 30px gaps`;
      } else if (templateType === 'ideas') {
        templateInstructions = `
💡 IDEAS/BRAINSTORM TEMPLATE - CREATE CREATIVE SCATTERED LAYOUT:
1. CENTRAL THEME: Large sticky note (width: 250, height: 150) at center
2. SCATTER IDEAS: Mix of sticky notes, stars, diamonds around center
3. KEY INSIGHTS: Use star shapes for important ideas
4. QUESTIONS: Use diamond shapes for open questions
5. CONNECTIONS: Dotted and curved arrows showing relationships
6. VISUAL VARIETY: Use multiple colors, different sizes
7. Layout: Organic/scattered but not overlapping`;
      }

      const generatePrompt = `You are MIRA, an elite creative consultant and visual thinking expert. You transform ideas into stunning, professional whiteboard visualizations that inspire and clarify.

═══════════════════════════════════════════════════════════
🎯 YOUR MISSION
═══════════════════════════════════════════════════════════

${designContext}

${contentAnalysis}

${templateInstructions}

═══════════════════════════════════════════════════════════
📋 EXACT TYPE VALUES (CRITICAL - case-sensitive)
═══════════════════════════════════════════════════════════

ALWAYS use these exact lowercase type values:
• "sticky" - for content cards (NOT "Sticky Note")
• "text" - for headers/labels (NOT "Text")  
• "arrow" - for connections (NOT "Arrow")
• "rect" - for containers (NOT "rectangle")
• "ellipse" - for nodes/highlights
• "diamond" - for decisions/questions
• "star" - for key points
• "triangle", "hexagon", "pentagon" - for variety

═══════════════════════════════════════════════════════════
🎨 ELEMENT BLUEPRINTS
═══════════════════════════════════════════════════════════

STICKY NOTES (primary content carriers):
{
  "type": "sticky",
  "x": 100, "y": 100,
  "width": 200, "height": 120,
  "text": "Your content here - can be multiple lines",
  "fillColor": "#FEF3C7",
  "borderRadius": 12,
  "fontSize": 14
}

HEADERS (bold text labels):
{
  "type": "text",
  "x": 100, "y": 50,
  "text": "Section Header",
  "fontSize": 24,
  "fillColor": "#1F2937",
  "fontWeight": "bold"
}

ARROWS (show relationships - USE VARIETY):
• Straight: { "type": "arrow", "points": [{"x": 280, "y": 160}, {"x": 340, "y": 160}], "strokeColor": "#64748B", "strokeWidth": 2, "arrowType": "straight" }
• Curved: { "type": "arrow", "points": [{"x": 280, "y": 160}, {"x": 380, "y": 220}], "strokeColor": "#8B5CF6", "strokeWidth": 2, "arrowType": "curved" }
• Elbow: { "type": "arrow", "points": [{"x": 280, "y": 160}, {"x": 280, "y": 300}], "strokeColor": "#64748B", "strokeWidth": 2, "arrowType": "elbow" }
• Dotted: Add "lineStyle": "dotted" for secondary connections
• Dashed: Add "lineStyle": "dashed" for optional/weak connections

SHAPES (visual variety - mix these in):
• Ellipse: { "type": "ellipse", "x": 100, "y": 100, "width": 140, "height": 80, "strokeColor": "#6366F1", "fillColor": "#EEF2FF", "strokeWidth": 2 }
• Diamond: { "type": "diamond", "x": 100, "y": 100, "width": 100, "height": 100, "strokeColor": "#F59E0B", "fillColor": "#FEF3C7" }
• Star: { "type": "star", "x": 100, "y": 100, "width": 60, "height": 60, "strokeColor": "#EAB308", "fillColor": "#FEF9C3" }
• Rect: { "type": "rect", "x": 100, "y": 100, "width": 250, "height": 400, "strokeColor": "#CBD5E1", "fillColor": "transparent", "lineStyle": "dashed" }

═══════════════════════════════════════════════════════════
🎨 COLOR SYSTEM (Professional Pastel Palette)
═══════════════════════════════════════════════════════════

Primary Content:
• Warm Yellow: #FEF3C7 - Main ideas, key concepts
• Soft Green: #D1FAE5 - Success, completed, positive
• Sky Blue: #DBEAFE - Information, process steps
• Light Purple: #EDE9FE - Special features, premium

Accents:
• Peach: #FED7AA - Secondary info, examples
• Pink: #FCE7F3 - Important, warnings, attention
• Mint: #A7F3D0 - Done, approved
• Lavender: #DDD6FE - Creative, innovative

Strokes/Connectors:
• Dark Gray: #374151 - Primary text
• Slate: #64748B - Arrows, borders
• Light Slate: #94A3B8 - Secondary connections

═══════════════════════════════════════════════════════════
📐 LAYOUT RULES (ABSOLUTELY CRITICAL)
═══════════════════════════════════════════════════════════

1. GRID SYSTEM: Place elements at x=100, 320, 540, 760 (columns 220px apart)
2. VERTICAL SPACING: Rows at y=100, 280, 460, 640 (160px apart)
3. NO OVERLAPS: Every element must have clear space around it
4. ARROWS CONNECT: Always add arrows between related elements
5. VISUAL HIERARCHY: Headers larger (fontSize: 24), content smaller (fontSize: 14)
6. GROUP RELATED: Keep related items close, separate sections with space
7. MIX SHAPES: Don't use only sticky notes - add ellipses, diamonds, stars for key points

═══════════════════════════════════════════════════════════
✨ CREATIVITY GUIDELINES
═══════════════════════════════════════════════════════════

• CREATE VISUAL STORIES: Don't just list - show relationships with arrows
• USE SHAPE SEMANTICS: Stars for important, diamonds for decisions, ellipses for concepts
• COLOR CODE: Related items share colors, different sections have different colors
• ADD STRUCTURE: Use dashed rectangles to group sections
• SHOW FLOW: Curved arrows for organic connections, straight for sequences
• HIERARCHICAL: Main topic bigger/bolder, details smaller

═══════════════════════════════════════════════════════════

Generate 12-20 diverse, well-connected elements that tell a visual story.

Return ONLY this JSON structure (no markdown, no explanation):
{
  "elements": [...],
  "hasMore": true/false,
  "nextPrompt": "description of what to add next if hasMore is true",
  "summary": "brief description of what was created"
}`;

      try {
        const aiResponse = await generateSmartContent(generatePrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-generate',
          skipRefinement: true // Prompt is already highly structured
        });

        // Extract JSON from response - more robust parsing
        let jsonStr = aiResponse.trim();

        // Remove markdown code blocks
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        // Try to find JSON object in the response
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          // Try to extract just the array if the response is malformed
          const arrayMatch = jsonStr.match(/\[[\s\S]*?\]/);
          if (arrayMatch) {
            try {
              parsed = { elements: JSON.parse(arrayMatch[0]), hasMore: false };
            } catch (e2) {
              // Last resort: try to fix common JSON issues
              let fixedJson = jsonStr
                .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
                .replace(/,\s*\]/g, ']') // Remove trailing commas in arrays
                .replace(/'/g, '"')      // Replace single quotes with double
                .replace(/(\w+):/g, '"$1":'); // Quote unquoted keys
              parsed = JSON.parse(fixedJson);
            }
          } else {
            throw new Error('Could not parse AI response as JSON');
          }
        }

        const generatedElements = Array.isArray(parsed) ? parsed : (parsed.elements || parsed);
        const hasMore = parsed.hasMore || false;
        const nextPrompt = parsed.nextPrompt || '';
        const summary = parsed.summary || `Generated ${generatedElements?.length || 0} elements`;

        if (!Array.isArray(generatedElements) || generatedElements.length === 0) {
          throw new Error('No elements were generated');
        }

        // Normalize type values (AI sometimes returns wrong casing)
        const normalizeType = (type) => {
          if (!type) return null;
          const typeMap = {
            'text': 'text',
            'Text': 'text',
            'TEXT': 'text',
            'sticky': 'sticky',
            'Sticky': 'sticky',
            'Sticky Note': 'sticky',
            'sticky note': 'sticky',
            'sticky_note': 'sticky',
            'stickyNote': 'sticky',
            'note': 'sticky',
            'Note': 'sticky',
            'arrow': 'arrow',
            'Arrow': 'arrow',
            'line': 'line',
            'Line': 'line',
            'rect': 'rect',
            'Rect': 'rect',
            'rectangle': 'rect',
            'Rectangle': 'rect',
            'ellipse': 'ellipse',
            'Ellipse': 'ellipse',
            'circle': 'ellipse',
            'Circle': 'ellipse',
            'diamond': 'diamond',
            'Diamond': 'diamond',
            'triangle': 'triangle',
            'Triangle': 'triangle',
            'star': 'star',
            'Star': 'star',
            'hexagon': 'hexagon',
            'Hexagon': 'hexagon',
            'pentagon': 'pentagon',
            'Pentagon': 'pentagon'
          };
          return typeMap[type] || type.toLowerCase();
        };

        // Add IDs and apply consistent styling
        const validObjects = generatedElements.map((obj, index) => {
          const id = `ai-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`;
          const normalizedType = normalizeType(obj.type);
          const baseObj = { id, opacity: 1, ...obj, type: normalizedType };

          if (!baseObj.type) return null;

          switch (baseObj.type) {
            case 'sticky':
              return {
                ...baseObj,
                width: baseObj.width || layout.avgElementSize.width || 180,
                height: baseObj.height || layout.avgElementSize.height || 120,
                text: (baseObj.text || '').replace(/\\n/g, '\n'),
                fillColor: baseObj.fillColor || '#FEF3C7',
                borderRadius: baseObj.borderRadius || 12
              };
            case 'rect':
              return {
                ...baseObj,
                strokeColor: baseObj.strokeColor || '#94A3B8',
                strokeWidth: baseObj.strokeWidth || 2,
                fillColor: baseObj.fillColor || 'transparent',
                borderRadius: baseObj.borderRadius || 12
              };
            case 'text':
              return {
                ...baseObj,
                text: baseObj.text || '',
                fontSize: baseObj.fontSize || 16,
                fillColor: baseObj.fillColor || '#374151',
                fontWeight: baseObj.fontWeight || 'normal',
                width: 300,
                height: 50
              };
            case 'arrow':
            case 'line':
              if (!baseObj.points || baseObj.points.length < 2) return null;
              return {
                ...baseObj,
                strokeColor: baseObj.strokeColor || '#94A3B8',
                strokeWidth: baseObj.strokeWidth || 2,
                arrowType: baseObj.arrowType || 'straight'
              };
            default:
              return {
                ...baseObj,
                strokeColor: baseObj.strokeColor || '#94A3B8',
                strokeWidth: baseObj.strokeWidth || 2,
                fillColor: baseObj.fillColor || 'transparent'
              };
          }
        }).filter(obj => obj !== null);

        // Add to current page
        const currentPage = whiteboard.pages[0] || { objects: [] };
        currentPage.objects = [...(currentPage.objects || []), ...validObjects];
        whiteboard.pages[0] = currentPage;

        // Context-aware response
        let responseMsg = `Created ${validObjects.length} elements. ${summary}`;
        if (hasMore && nextPrompt) {
          responseMsg += ` More content available: "${nextPrompt}"`;
        }

        whiteboard.aiAnalysis.messages.push(
          { role: 'user', content: `Create: ${message}`, timestamp: new Date() },
          { role: 'assistant', content: responseMsg, timestamp: new Date() }
        );

        // Store continuation info
        if (hasMore && nextPrompt) {
          whiteboard.aiAnalysis.pendingGeneration = {
            nextPrompt,
            originalRequest: message,
            timestamp: new Date()
          };
        } else {
          whiteboard.aiAnalysis.pendingGeneration = null;
        }

        await whiteboard.save();

        return NextResponse.json({
          success: true,
          generatedObjects: validObjects,
          objectCount: validObjects.length,
          pages: whiteboard.pages,
          aiAnalysis: whiteboard.aiAnalysis,
          hasMore,
          nextPrompt,
          summary
        });

      } catch (parseError) {
        console.error('Failed to parse AI generated objects:', parseError);
        return NextResponse.json({
          error: 'Failed to generate content. Try being more specific about what you want to create.'
        }, { status: 400 });
      }

    } else if (action === 'continue') {
      // Continue generating from where we left off
      const pendingGen = whiteboard.aiAnalysis.pendingGeneration;
      const existingObjects = whiteboard.pages[0]?.objects || [];
      const layout = analyzeLayout(existingObjects);
      const existingCanvasDescription = describeCanvasObjects(whiteboard.pages);

      // Calculate safe positions for new content
      const safeStartY = Math.round((layout.bounds.maxY || 100) + 60);
      const safeStartX = Math.round(layout.bounds.minX || 100);

      // Build continuation prompt
      const continuePrompt = `You are MIRA, continuing to build a professional whiteboard visualization.

═══════════════════════════════════════════════════════════
EXISTING CANVAS (${layout.objectCount} elements):
═══════════════════════════════════════════════════════════
${existingCanvasDescription}

═══════════════════════════════════════════════════════════
CONTINUATION CONTEXT:
═══════════════════════════════════════════════════════════
ORIGINAL REQUEST: "${pendingGen?.originalRequest || message || 'Continue building the diagram'}"
WHAT TO CREATE NEXT: "${pendingGen?.nextPrompt || message || 'Add more related content'}"

POSITIONING (CRITICAL - avoid overlaps):
• Start new elements at Y = ${safeStartY} (below existing content)
• Use X positions: ${safeStartX}, ${safeStartX + 220}, ${safeStartX + 440}, ${safeStartX + 660}
• Each sticky note needs ~200x150 space

═══════════════════════════════════════════════════════════
ELEMENT TYPES (use variety):
═══════════════════════════════════════════════════════════
• "sticky" - Content cards (width: 200, height: 120-180 based on content)
• "text" - Headers (fontSize: 20-24, fontWeight: "bold")
• "arrow" - Connections (arrowType: "straight"|"curved"|"elbow", lineStyle: "solid"|"dashed"|"dotted")
• "ellipse" - Highlight nodes
• "diamond" - Decision points
• "star" - Key insights
• "rect" - Group containers (fillColor: "transparent", lineStyle: "dashed")

COLORS: #FEF3C7 (yellow), #D1FAE5 (green), #DBEAFE (blue), #EDE9FE (purple), #FCE7F3 (pink)

═══════════════════════════════════════════════════════════

Generate 10-15 MORE elements that continue and complete the visualization.
ADD ARROWS to connect new content to existing content where relevant.

Return ONLY valid JSON:
{
  "elements": [...],
  "hasMore": true/false,
  "nextPrompt": "What to generate next if hasMore",
  "summary": "What was created"
}`;

      try {
        const aiResponse = await generateSmartContent(continuePrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-continue',
          skipRefinement: true
        });

        let jsonStr = aiResponse.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        // Try to find JSON object
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          const arrayMatch = jsonStr.match(/\[[\s\S]*?\]/);
          if (arrayMatch) {
            try {
              parsed = { elements: JSON.parse(arrayMatch[0]), hasMore: false };
            } catch (e2) {
              throw new Error('Failed to parse continuation response');
            }
          } else {
            throw new Error('No valid JSON found in continuation response');
          }
        }

        const generatedElements = Array.isArray(parsed) ? parsed : (parsed.elements || parsed);
        const hasMore = parsed.hasMore || false;
        const nextPrompt = parsed.nextPrompt || '';
        const summary = parsed.summary || `Added ${generatedElements?.length || 0} elements`;

        if (!Array.isArray(generatedElements) || generatedElements.length === 0) {
          throw new Error('No elements generated in continuation');
        }

        // Normalize types
        const normalizeType = (type) => {
          if (!type) return null;
          const typeMap = {
            'sticky': 'sticky', 'Sticky': 'sticky', 'Sticky Note': 'sticky', 'note': 'sticky',
            'text': 'text', 'Text': 'text',
            'arrow': 'arrow', 'Arrow': 'arrow',
            'line': 'line', 'Line': 'line',
            'rect': 'rect', 'rectangle': 'rect', 'Rectangle': 'rect',
            'ellipse': 'ellipse', 'circle': 'ellipse', 'Circle': 'ellipse',
            'diamond': 'diamond', 'Diamond': 'diamond',
            'star': 'star', 'Star': 'star',
            'triangle': 'triangle', 'hexagon': 'hexagon', 'pentagon': 'pentagon'
          };
          return typeMap[type] || type.toLowerCase();
        };

        // Process elements
        const validObjects = generatedElements.map((obj, index) => {
          const id = `ai-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`;
          const normalizedType = normalizeType(obj.type);
          const baseObj = { id, opacity: 1, ...obj, type: normalizedType };

          if (!baseObj.type) return null;

          if (baseObj.type === 'sticky') {
            return {
              ...baseObj,
              width: baseObj.width || 200,
              height: baseObj.height || 120,
              text: (baseObj.text || '').replace(/\\n/g, '\n'),
              fillColor: baseObj.fillColor || '#FEF3C7',
              borderRadius: 12
            };
          } else if (baseObj.type === 'text') {
            return { ...baseObj, fontSize: baseObj.fontSize || 20, fillColor: baseObj.fillColor || '#1F2937', fontWeight: baseObj.fontWeight || 'bold', width: 300, height: 50 };
          } else if (baseObj.type === 'arrow' || baseObj.type === 'line') {
            if (!baseObj.points || baseObj.points.length < 2) return null;
            return { ...baseObj, strokeColor: baseObj.strokeColor || '#64748B', strokeWidth: baseObj.strokeWidth || 2 };
          } else {
            return { ...baseObj, strokeColor: baseObj.strokeColor || '#94A3B8', strokeWidth: baseObj.strokeWidth || 2, fillColor: baseObj.fillColor || 'transparent', borderRadius: baseObj.borderRadius || 8 };
          }
        }).filter(obj => obj !== null);

        // Add to page
        const currentPage = whiteboard.pages[0] || { objects: [] };
        currentPage.objects = [...(currentPage.objects || []), ...validObjects];
        whiteboard.pages[0] = currentPage;

        let responseMsg = `Added ${validObjects.length} more elements. ${summary}`;
        if (hasMore) responseMsg += ` Still more to add.`;

        whiteboard.aiAnalysis.messages.push(
          { role: 'user', content: 'Continue generating', timestamp: new Date() },
          { role: 'assistant', content: responseMsg, timestamp: new Date() }
        );

        if (hasMore && nextPrompt) {
          whiteboard.aiAnalysis.pendingGeneration = { nextPrompt, originalRequest: pendingGen?.originalRequest, timestamp: new Date() };
        } else {
          whiteboard.aiAnalysis.pendingGeneration = null;
        }

        await whiteboard.save();

        return NextResponse.json({
          success: true,
          generatedObjects: validObjects,
          objectCount: validObjects.length,
          pages: whiteboard.pages,
          aiAnalysis: whiteboard.aiAnalysis,
          hasMore,
          nextPrompt,
          summary
        });

      } catch (parseError) {
        console.error('Failed to continue generation:', parseError);
        whiteboard.aiAnalysis.pendingGeneration = null;
        await whiteboard.save();
        return NextResponse.json({ error: 'Failed to continue. Try describing what else you want to add.' }, { status: 400 });
      }
    } else if (action === 'restructure') {
      // Restructure/cleanup existing canvas - straighten lines, align elements, fix spacing
      const existingObjects = whiteboard.pages[0]?.objects || [];

      if (existingObjects.length === 0) {
        return NextResponse.json({
          error: 'Canvas is empty. Add some content first before restructuring.'
        }, { status: 400 });
      }

      const layout = analyzeLayout(existingObjects);
      const existingCanvasDescription = describeCanvasObjects(whiteboard.pages);

      const restructurePrompt = `You are MIRA, an expert at cleaning up and professionalizing whiteboard diagrams.

CURRENT CANVAS STATE:
${existingCanvasDescription}

LAYOUT ANALYSIS:
- Pattern: ${layout.pattern}
- Bounds: (${Math.round(layout.bounds.minX)}, ${Math.round(layout.bounds.minY)}) to (${Math.round(layout.bounds.maxX)}, ${Math.round(layout.bounds.maxY)})
- ${layout.objectCount} total elements

YOUR TASK: Restructure ALL existing objects to create a clean, professional diagram.

RESTRUCTURING RULES:
1. ALIGN elements to a clean grid (snap to nearest 20px)
2. STANDARDIZE sizes - similar elements should have the same dimensions
3. FIX SPACING - use consistent gaps (60-80px between elements)
4. STRAIGHTEN arrows and lines - use horizontal, vertical, or 45° angles only
5. ORGANIZE into clear rows or columns based on the detected ${layout.pattern} pattern
6. APPLY professional colors:
   - Stickies: Use pastel colors (#FEF3C7, #A7F3D0, #BAE6FD, #DDD6FE, #FECDD3)
   - Borders: Use #94A3B8 (slate gray)
   - Text: Use #475569 (slate 600)
7. ADD border radius (12-16px) to all rectangles and stickies
8. PRESERVE all text content exactly as-is
9. MAINTAIN the logical groupings and relationships

OUTPUT: Return a JSON array with ALL restructured objects. Each object must include:
- id: Keep the ORIGINAL id from the input (very important for replacement)
- All original properties, but with corrected positions, sizes, and styling

The output replaces ALL existing objects, so include every element.

Return ONLY valid JSON array. No explanations.`;

      try {
        const aiResponse = await generateSmartContent(restructurePrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-restructure',
          skipRefinement: true
        });

        let jsonStr = aiResponse.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const restructuredObjects = JSON.parse(jsonStr);

        if (!Array.isArray(restructuredObjects)) {
          throw new Error('Restructured content is not an array');
        }

        // Validate and ensure all objects have required properties
        const validObjects = restructuredObjects.map((obj, index) => {
          // Preserve original ID or generate new one
          const id = obj.id || `restructured-${Date.now()}-${index}`;
          const baseObj = { ...obj, id, opacity: obj.opacity || 1 };

          // Apply professional styling defaults
          if (baseObj.type === 'sticky') {
            baseObj.borderRadius = baseObj.borderRadius || 12;
            baseObj.fillColor = baseObj.fillColor || '#FEF3C7';
          } else if (baseObj.type === 'rect') {
            baseObj.borderRadius = baseObj.borderRadius || 12;
            baseObj.strokeColor = baseObj.strokeColor || '#94A3B8';
          } else if (baseObj.type === 'text') {
            baseObj.fillColor = baseObj.fillColor || '#475569';
          } else if (baseObj.type === 'arrow' || baseObj.type === 'line') {
            baseObj.strokeColor = baseObj.strokeColor || '#64748B';
          }

          // Snap positions to grid (20px)
          if (baseObj.x !== undefined) baseObj.x = Math.round(baseObj.x / 20) * 20;
          if (baseObj.y !== undefined) baseObj.y = Math.round(baseObj.y / 20) * 20;

          return baseObj;
        }).filter(obj => obj && obj.type);

        // Replace all objects with restructured version
        whiteboard.pages[0] = {
          ...whiteboard.pages[0],
          objects: validObjects
        };

        whiteboard.aiAnalysis.messages.push(
          { role: 'user', content: 'Restructure and clean up the canvas', timestamp: new Date() },
          { role: 'assistant', content: `I've restructured your diagram: aligned ${validObjects.length} elements to a clean grid, standardized spacing, straightened connections, and applied professional styling. The logical structure and all your content has been preserved.`, timestamp: new Date() }
        );

        await whiteboard.save();

        return NextResponse.json({
          success: true,
          restructuredObjects: validObjects,
          objectCount: validObjects.length,
          pages: whiteboard.pages,
          aiAnalysis: whiteboard.aiAnalysis
        });

      } catch (parseError) {
        console.error('Failed to restructure canvas:', parseError);
        return NextResponse.json({
          error: 'Failed to restructure the canvas. Try selecting fewer elements or simplifying the layout first.'
        }, { status: 400 });
      }
    } else if (action === 'prepare') {
      // MIRA Agent Mode - Prepare structured content before plotting
      if (!message || !message.trim()) {
        return NextResponse.json({ error: 'Content description is required' }, { status: 400 });
      }

      const templateType = body.templateType || 'mindmap';
      
      // Enhanced template-specific structure definitions - DYNAMIC with no hardcoded limits
      const templateStructures = {
        mindmap: {
          description: 'comprehensive radial thought map with central topic and extensively branching ideas - unlimited depth and breadth',
          minSections: 6,
          maxSections: 15,
          itemsPerSection: '10-50',
          dynamicLayout: true,
          sections: [
            { type: 'central', title: 'Core Concept & Definition', purpose: 'The fundamental definition, scope, and significance of the topic' },
            { type: 'branch', title: 'Key Dimensions & Components', purpose: 'All primary aspects, pillars, or dimensions of the topic' },
            { type: 'context', title: 'Market/Industry Context', purpose: 'Current landscape, trends, statistics, and relevant data points' },
            { type: 'stakeholders', title: 'Stakeholders & Audience', purpose: 'Who is affected, target demographics, user personas, decision makers' },
            { type: 'strategies', title: 'Strategies & Approaches', purpose: 'Methodologies, frameworks, best practices, proven techniques' },
            { type: 'challenges', title: 'Challenges & Solutions', purpose: 'Common obstacles, risks, mitigation strategies, and workarounds' },
            { type: 'metrics', title: 'Success Metrics & KPIs', purpose: 'How to measure success, benchmarks, industry standards' },
            { type: 'action', title: 'Implementation Roadmap', purpose: 'Concrete next steps, priorities, quick wins, long-term initiatives' },
            { type: 'dependencies', title: 'Dependencies & Prerequisites', purpose: 'What needs to be in place, blockers, enablers' },
            { type: 'alternatives', title: 'Alternatives & Options', purpose: 'Other approaches, plan B scenarios, contingencies' },
            { type: 'resources', title: 'Resources & Tools', purpose: 'Required tools, platforms, documentation, references' },
            { type: 'timeline', title: 'Timeline & Milestones', purpose: 'Key dates, phases, checkpoints' },
          ]
        },
        flowchart: {
          description: 'detailed process flow with comprehensive steps, decision logic, exception handling, and all possible paths',
          minSections: 5,
          maxSections: 15,
          itemsPerSection: '10-50',
          dynamicLayout: true,
          sections: [
            { type: 'prerequisites', title: 'Prerequisites & Inputs', purpose: 'Required resources, data, approvals, or conditions needed before starting' },
            { type: 'start', title: 'Initiation Phase', purpose: 'Entry points, triggers, and initial setup steps' },
            { type: 'core_process', title: 'Core Process Steps', purpose: 'Detailed sequential actions with specific instructions' },
            { type: 'decisions', title: 'Decision Points & Logic', purpose: 'Conditional branches, criteria for each path, edge cases' },
            { type: 'parallel', title: 'Parallel Workflows', purpose: 'Concurrent activities, dependencies, synchronization points' },
            { type: 'exceptions', title: 'Exception Handling', purpose: 'Error scenarios, fallback procedures, escalation paths' },
            { type: 'outputs', title: 'Outputs & Deliverables', purpose: 'Expected results, quality criteria, handoff points' },
            { type: 'loops', title: 'Iteration & Loops', purpose: 'Repeat conditions, loop exits, retry logic' },
            { type: 'validation', title: 'Validation & Quality Gates', purpose: 'Checkpoints, verification steps, approval stages' },
            { type: 'rollback', title: 'Rollback & Recovery', purpose: 'Undo procedures, recovery paths, fallback options' },
          ]
        },
        planning: {
          description: 'comprehensive project plan with strategic objectives, detailed tasks, resource allocation, and full timeline',
          minSections: 6,
          maxSections: 15,
          itemsPerSection: '10-50',
          dynamicLayout: true,
          sections: [
            { type: 'vision', title: 'Vision & Objectives', purpose: 'Strategic goals, success criteria, alignment with broader initiatives' },
            { type: 'scope', title: 'Scope Definition', purpose: 'In-scope items, out-of-scope items, boundaries and constraints' },
            { type: 'phases', title: 'Project Phases', purpose: 'Major phases with durations, phase gates, and deliverables' },
            { type: 'tasks', title: 'Detailed Task Breakdown', purpose: 'Specific work items, owners, effort estimates, priorities' },
            { type: 'resources', title: 'Resources & Budget', purpose: 'Team allocation, tools needed, budget considerations' },
            { type: 'risks', title: 'Risks & Mitigation', purpose: 'Identified risks, probability, impact, mitigation strategies' },
            { type: 'milestones', title: 'Milestones & Deadlines', purpose: 'Key dates, dependencies, critical path items' },
            { type: 'governance', title: 'Governance & Review', purpose: 'Review cadence, stakeholder updates, decision authority' },
            { type: 'communication', title: 'Communication Plan', purpose: 'Stakeholder updates, reporting frequency, channels' },
            { type: 'quality', title: 'Quality Assurance', purpose: 'Testing approach, acceptance criteria, sign-off process' },
            { type: 'dependencies', title: 'Dependencies & Blockers', purpose: 'External dependencies, internal blockers, resolution paths' },
            { type: 'success_criteria', title: 'Success Criteria & KPIs', purpose: 'Measurable outcomes, metrics, benchmarks' },
          ]
        },
        eventcircuit: {
          description: 'exhaustive decision chain reaction analysis mapping ALL possible permutations, branching outcomes, probability assessments, and convergent conclusions',
          minSections: 12,
          maxSections: 20,
          itemsPerSection: '10-50',
          dynamicChainDepth: true,
          sections: [
            { type: 'root_decision', title: 'Core Decision/Goal', purpose: 'The central decision or goal being analyzed - the single starting point of the entire chain reaction' },
            { type: 'context_constraints', title: 'Context & Constraints', purpose: 'Environmental factors, limitations, resources available, stakeholders involved, timeline pressures' },
            { type: 'possible_actions', title: 'Possible Actions/Choices', purpose: 'All distinct action paths that can be taken from the root decision - each becomes a major branch' },
            { type: 'immediate_outcomes_t0', title: 'Immediate Outcomes (T+0)', purpose: 'Direct first-order effects for EACH action choice - what happens within hours/days of decision' },
            { type: 'chain_reactions_t1', title: 'Chain Reactions (T+1)', purpose: 'Second-order effects triggered by T+0 outcomes - branching possibilities within weeks' },
            { type: 'chain_reactions_t2', title: 'Chain Reactions (T+2)', purpose: 'Third-order cascading effects from T+1 - compound consequences within months' },
            { type: 'chain_reactions_t3', title: 'Chain Reactions (T+3)', purpose: 'Fourth-order deep cascade effects - long-term ramifications within 6-12 months' },
            { type: 'chain_reactions_t4_plus', title: 'Deep Cascade (T+4+)', purpose: 'Fifth-order and beyond - ultimate long-term consequences, generational effects if applicable' },
            { type: 'decision_nodes', title: 'Critical Decision Points', purpose: 'Key branching moments where choices must be made - IF/THEN decision diamonds in the flow' },
            { type: 'probability_matrix', title: 'Probability Matrix', purpose: 'Likelihood percentages for each branch path with confidence levels and key assumptions' },
            { type: 'risk_cascade', title: 'Risk Cascade Pathways', purpose: 'Failure chains showing how small risks compound into major problems - worst-case scenario mapping' },
            { type: 'opportunity_cascade', title: 'Opportunity Cascade Pathways', purpose: 'Success amplifier chains showing how wins compound - best-case scenario mapping' },
            { type: 'convergence_points', title: 'Convergence Points', purpose: 'Where multiple branches merge back together - common outcomes from different paths' },
            { type: 'terminal_outcomes', title: 'Terminal Outcomes', purpose: 'ALL possible final conclusions/endpoints of the chain reaction - multiple end states' },
            { type: 'optimal_path', title: 'Optimal Path Analysis', purpose: 'The recommended route with highest probability-weighted success - step by step actions' },
            { type: 'alternative_paths', title: 'Alternative Viable Paths', purpose: 'Backup routes and pivot strategies if primary path encounters obstacles' },
            { type: 'early_warning_indicators', title: 'Early Warning Indicators', purpose: 'Signals that indicate which branch path is actualizing - monitoring triggers' },
            { type: 'action_items', title: 'Immediate Action Items', purpose: 'Concrete next steps to execute with owners, deadlines, and success metrics' },
          ]
        },
        ideas: {
          description: 'extensive creative brainstorm with categorized concepts, feasibility analysis, prioritization, and actionable next steps - unlimited ideas',
          minSections: 6,
          maxSections: 15,
          itemsPerSection: '10-50',
          dynamicLayout: true,
          sections: [
            { type: 'theme', title: 'Central Theme & Context', purpose: 'Core problem statement, opportunity space, constraints' },
            { type: 'research', title: 'Research & Insights', purpose: 'Data points, user insights, market research, competitor analysis' },
            { type: 'categories', title: 'Idea Categories', purpose: 'Grouped concepts by theme, approach, or target segment' },
            { type: 'innovative', title: 'Innovative Concepts', purpose: 'Bold, disruptive, or unconventional ideas worth exploring' },
            { type: 'practical', title: 'Practical Solutions', purpose: 'Immediately actionable, low-risk, quick-win ideas' },
            { type: 'moonshots', title: 'Moonshot Ideas', purpose: 'High-risk high-reward transformational concepts' },
            { type: 'incremental', title: 'Incremental Improvements', purpose: 'Small optimizations that compound over time' },
            { type: 'evaluation', title: 'Feasibility Analysis', purpose: 'Pros/cons, resource requirements, implementation complexity' },
            { type: 'priorities', title: 'Prioritized Recommendations', purpose: 'Top picks with rationale, suggested sequencing' },
            { type: 'validation', title: 'Validation Methods', purpose: 'How to test each idea, experiments, MVPs' },
            { type: 'resources', title: 'Required Resources', purpose: 'What is needed to execute - people, tools, budget' },
            { type: 'next_steps', title: 'Exploration Paths', purpose: 'Questions to answer, experiments to run, validation needed' },
          ]
        }
      };

      const structure = templateStructures[templateType] || templateStructures.mindmap;

      // Template-specific deep research instructions
      const templateSpecificInstructions = {
        eventcircuit: `
=== EVENT CIRCUIT CHAIN REACTION ANALYSIS - COMPREHENSIVE INSTRUCTIONS ===

You are building a COMPLETE DECISION TREE that maps EVERY possible permutation and combination of outcomes. Think like a chess grandmaster calculating 20 moves ahead combined with a probability theorist.

🎯 CORE MANDATE: Generate an EXHAUSTIVE chain reaction analysis until ALL branches reach natural conclusions. Do NOT artificially limit the depth or breadth.

═══════════════════════════════════════════════════════════════════════════════
CHAIN REACTION RULES - FOLLOW EXACTLY:
═══════════════════════════════════════════════════════════════════════════════

1. SINGLE ROOT: Start with ONE clear decision/goal as the root node

2. BRANCHING LOGIC:
   - Every action creates 2-6 possible outcome branches
   - Every outcome can trigger new decisions (IF this happens, THEN these options...)
   - Label each branch with: "IF [condition] → THEN [outcome] (X% probability)"
   - Continue branching until you reach terminal states (conclusions)

3. TEMPORAL CHAIN DEPTH:
   - T+0: Immediate (hours/days) - What happens RIGHT after the decision?
   - T+1: Short-term (weeks) - What does T+0 trigger?
   - T+2: Medium-term (months) - What does T+1 cascade into?
   - T+3: Long-term (6-12 months) - Compound effects
   - T+4+: Ultimate outcomes (1+ years) - Final state
   - KEEP GOING until natural conclusion - do NOT stop artificially

4. DECISION NODE FORMAT:
   Each decision point must specify:
   - The decision/choice to be made
   - All possible options (minimum 2, typically 3-5)
   - Probability % for each option being chosen/occurring
   - Key factors that influence which option manifests

5. OUTCOME NODE FORMAT:
   Each outcome must include:
   - Clear description of what happens
   - Probability % of this outcome
   - Impact rating (1-10 scale)
   - Time to manifest
   - What it triggers next (next decision or terminal state)

6. TERMINAL OUTCOMES:
   - Multiple endpoints are EXPECTED (rarely single conclusion)
   - Each terminal outcome should have:
     • Final state description
     • Cumulative probability to reach this state
     • Overall impact assessment (positive/negative/neutral)
     • Path summary (key decisions that led here)

═══════════════════════════════════════════════════════════════════════════════
CONTENT DENSITY REQUIREMENTS:
═══════════════════════════════════════════════════════════════════════════════

- MINIMUM 10 items per section (target 10-15 per section, NEVER less than 8)
- For complex chain reactions, aim for 15-25 items per section
- Be SPECIFIC with numbers, percentages, timeframes, and metrics
- Include ACTIONABLE details - who does what, when, how
- Every probability must be justified with reasoning
- Map ALL failure modes AND success amplifiers
- Identify convergence points where different paths lead to same outcome
- Include probability percentages on EVERY branch (must sum to 100% for siblings)

═══════════════════════════════════════════════════════════════════════════════
ITEM FORMAT - USE THIS EXACTLY:
═══════════════════════════════════════════════════════════════════════════════

For decision nodes:
"[DECISION] {Decision description} | Options: {Option A (X%), Option B (Y%), Option C (Z%)} | Factors: {key influencing factors}"

For outcome nodes:
"[OUTCOME] {What happens} | Probability: {X%} | Impact: {1-10} | Timeframe: {when} | Triggers: {what happens next}"

For terminal outcomes:
"[TERMINAL] {Final state} | Cumulative Probability: {X%} | Net Impact: {positive/negative/neutral, 1-10} | Path: {key decisions}"

═══════════════════════════════════════════════════════════════════════════════
EXAMPLE CHAIN STRUCTURE:
═══════════════════════════════════════════════════════════════════════════════

ROOT: "Launch new product in competitive market"
├── [DECISION] Market entry timing | Options: Q1 Launch (40%), Q2 Launch (35%), Delay to Q3 (25%) | Factors: competitor moves, resource readiness
│   ├── IF Q1 Launch (40%):
│   │   ├── [OUTCOME] First mover advantage captured | Probability: 60% | Impact: 8 | Timeframe: 2 weeks | Triggers: competitor response decision
│   │   │   ├── [DECISION] Competitor response | Options: Price war (30%), Feature race (45%), Market segmentation (25%)
│   │   │   │   ├── IF Price war → [OUTCOME] Margin compression | Probability: 70% | Impact: -6 | Timeframe: 1 month | Triggers: sustainability assessment
│   │   │   │   │   └── [TERMINAL] Market consolidation - 2 players remain | Cumulative: 8.4% | Net Impact: +3 | Path: Q1→FirstMover→PriceWar→Consolidation
│   │   │   │   └── [continues branching...]
│   │   └── [OUTCOME] Market resistance | Probability: 40% | Impact: -4 | Timeframe: 1 month | Triggers: pivot decision
│   └── [continues for other timing options...]

═══════════════════════════════════════════════════════════════════════════════
PROBABILITY RULES:
═══════════════════════════════════════════════════════════════════════════════

- Sibling branches from same decision node must sum to 100%
- Cumulative path probability = product of all probabilities along path
- Flag any path with <5% cumulative probability as "Edge Case"
- Highlight paths with >25% cumulative probability as "Primary Scenario"
- Mark paths with >40% cumulative probability as "Most Likely Outcome"

OUTPUT ALL SECTIONS FULLY - DO NOT TRUNCATE OR SUMMARIZE. CONTINUE UNTIL NATURAL CONCLUSIONS.
`,
        mindmap: `
=== MINDMAP DEEP DIVE INSTRUCTIONS ===
Create a comprehensive knowledge map that serves as a single source of truth for this topic.

⚠️ MANDATORY ITEM COUNT - NON-NEGOTIABLE:
- Each section MUST have 10-15 items (minimum 8, target 12)
- If you write only 5 items, STOP and add 5-7 more
- 5 items per section is UNACCEPTABLE and will be rejected

CONTENT REQUIREMENTS:
- Central concept should capture the ESSENCE in 3-5 words
- Each branch should represent a DISTINCT dimension (not overlapping)
- Sub-branches should drill down to SPECIFIC, actionable insights
- Include real data, benchmarks, and industry standards where applicable
- Cover ALL angles: who, what, when, where, why, how
- Include contrarian views and edge cases
- DO NOT artificially limit content - explore every relevant aspect
`,
        flowchart: `
=== FLOWCHART PROCESS ANALYSIS INSTRUCTIONS ===
Map the process with PRECISION and COMPLETENESS.

⚠️ MANDATORY ITEM COUNT - NON-NEGOTIABLE:
- Each section MUST have 10-15 items (minimum 8, target 12)
- If you write only 5 items, STOP and add 5-7 more
- 5 items per section is UNACCEPTABLE and will be rejected

CONTENT REQUIREMENTS:
- Include ALL decision points, not just the happy path
- Show exception handling and error recovery for EVERY failure mode
- Add time estimates where relevant
- Identify bottlenecks and optimization opportunities
- Include parallel processes that can run simultaneously
- Map edge cases and rare scenarios
- Document prerequisites and post-conditions for each step
`,
        planning: `
=== PROJECT PLANNING INSTRUCTIONS ===
Create a BATTLE-READY, COMPREHENSIVE project plan.

⚠️ MANDATORY ITEM COUNT - NON-NEGOTIABLE:
- Each section MUST have 10-15 items (minimum 8, target 12)
- If you write only 5 items, STOP and add 5-7 more
- 5 items per section is UNACCEPTABLE and will be rejected

CONTENT REQUIREMENTS:
- Every task should be specific enough to be assigned to someone
- Include dependencies and blockers for EACH task
- Estimate effort realistically (include buffer for unknowns)
- Identify ALL critical path items
- Plan for risks before they happen
- Include communication touchpoints
- Document success criteria and acceptance tests
`,
        ideas: `
=== BRAINSTORMING DEEP DIVE INSTRUCTIONS ===
Generate ideas that span the FULL spectrum from safe to revolutionary.

⚠️ MANDATORY ITEM COUNT - NON-NEGOTIABLE:
- Each section MUST have 10-15 items (minimum 8, target 12)
- If you write only 5 items, STOP and add 5-7 more
- 5 items per section is UNACCEPTABLE and will be rejected

CONTENT REQUIREMENTS:
- Include at least 5 "crazy" ideas that challenge assumptions
- Ground innovative ideas in feasibility assessment
- Cross-pollinate ideas from adjacent industries
- Include quick wins AND long-term moonshots
- Rate each idea on effort/impact
- Include ideas from different stakeholder perspectives
`
      };

      const templateInstructions = templateSpecificInstructions[templateType] || '';

      const preparePrompt = `You are MIRA, an elite strategic consultant and expert researcher with deep expertise in business strategy, market analysis, project management, and creative problem-solving.

USER REQUEST: "${message}"
TEMPLATE TYPE: ${templateType} - ${structure.description}
${templateInstructions}
=== RESEARCH MANDATE ===
You must conduct EXHAUSTIVE, PROFESSIONAL-LEVEL research and analysis on this topic. Think like a McKinsey consultant, a Harvard Business School professor, and a domain expert combined.

Your analysis should be:
- COMPREHENSIVE: Cover every significant angle, dimension, and consideration
- SPECIFIC: Use concrete examples, real data points, actual metrics, industry benchmarks
- ACTIONABLE: Every item should be implementable, not vague platitudes
- INSIGHTFUL: Provide non-obvious connections, hidden opportunities, contrarian perspectives
- STRUCTURED: Logical flow from analysis to recommendations to action
- PROFESSIONAL: Use appropriate business terminology and frameworks

=== DEEP RESEARCH REQUIREMENTS ===
For the topic "${message}", you must explore:

1. FOUNDATIONAL UNDERSTANDING
   - What is the core definition and scope?
   - What are the historical context and evolution?
   - What are the fundamental principles at play?

2. CURRENT LANDSCAPE ANALYSIS
   - What are the latest trends and developments?
   - Who are the key players, competitors, or stakeholders?
   - What are the current best practices?
   - What data/statistics are relevant?

3. STRATEGIC DIMENSIONS
   - What are all the critical success factors?
   - What frameworks or methodologies apply?
   - What are the common pitfalls and how to avoid them?
   - What differentiates good from great execution?

4. STAKEHOLDER PERSPECTIVES
   - Who benefits and how?
   - What are different user/customer segments?
   - What are the organizational implications?

5. IMPLEMENTATION CONSIDERATIONS
   - What resources are required?
   - What is realistic timeline?
   - What are dependencies and prerequisites?
   - What are the quick wins vs long-term investments?

6. RISK & OPPORTUNITY ANALYSIS
   - What could go wrong?
   - What opportunities are often missed?
   - How to measure success?

=== EXPECTED OUTPUT STRUCTURE ===
Generate ${structure.minSections}-${structure.maxSections} comprehensive sections:
${structure.sections.map((s, i) => `${i + 1}. ${s.title} - ${s.purpose}`).join('\n')}

═══════════════════════════════════════════════════════════════════════════════
ITEM COUNT GUIDANCE - CRITICAL - MUST FOLLOW
═══════════════════════════════════════════════════════════════════════════════

⚠️ STRICT REQUIREMENT - YOUR RESPONSE WILL BE REJECTED IF NOT MET:

For EACH section, you MUST provide:
- A clear, specific title (not generic)
- MINIMUM 10 items per section (absolute minimum 8, NEVER 5 or fewer)
- TARGET: 10-15 items per section
- Each item should be a complete, specific thought (10-25 words)
- A concise summary

❌ UNACCEPTABLE: Sections with only 4-6 items - this is insufficient depth
✅ ACCEPTABLE: Sections with 10-15 items showing comprehensive analysis

If you find yourself writing only 5-6 items, STOP and add more by:
1. Breaking down points into more specific sub-aspects
2. Adding "what NOT to do" versions of items  
3. Including stakeholder-specific perspectives
4. Adding measurement/metrics for abstract items
5. Including real-world examples or case study references
6. Adding prerequisites or dependencies
7. Including common mistakes to avoid
8. Adding best practice variations

═══════════════════════════════════════════════════════════════════════════════

=== CRITICAL GUIDELINES ===
- NO generic filler content - every item must be specific to this topic
- NO emojis anywhere
- Each item should stand alone as valuable insight
- Use specific numbers, percentages, or benchmarks where applicable
- Include contrarian or non-obvious perspectives
- Make connections between sections explicit
- The conclusion should synthesize key insights into strategic recommendations
- Focus on COMPLETENESS - cover all angles, not just the obvious ones

Return ONLY this JSON structure (no markdown, no explanation):
{
  "title": "Compelling, specific title for this ${templateType}",
  "description": "Executive summary of what this analysis covers and its value (2-3 sentences)",
  "templateType": "${templateType}",
  "sections": [
    {
      "type": "section_type",
      "title": "Specific Section Title",
      "items": [
        "1. First detailed, specific, actionable item with concrete guidance",
        "2. Second specific item that provides real insight and value",
        "3. Third item with specific data point or benchmark",
        "4. Fourth item covering another angle of this topic",
        "5. Fifth item with actionable recommendation",
        "6. Sixth item exploring edge cases or exceptions",
        "7. Seventh item with best practice guidance",
        "8. Eighth item covering common mistakes to avoid",
        "9. Ninth item with specific tool or method recommendation",
        "10. Tenth item with measurement or success criteria (MINIMUM REQUIRED)",
        "11. Eleventh item with stakeholder consideration",
        "12. Twelfth item with resource or budget implication",
        "13. Thirteenth item with timeline or milestone guidance",
        "14. Fourteenth item with risk or mitigation strategy",
        "15. Fifteenth item completing comprehensive coverage (TARGET)"
      ],
      "summary": "Key insight or takeaway from this section (1-2 sentences)",
      "color": {
        "bg": "bg-color-50",
        "border": "border-color-200",
        "text": "text-color-700"
      }
    }
  ],
  "conclusion": "Strategic synthesis: What are the 3-5 most important takeaways and recommended next steps? Be specific and actionable.",
  "metadata": {
    "itemCount": "total_items_should_be_120_plus_for_12_sections",
    "estimatedElements": "approximate_canvas_elements_needed",
    "researchDepth": "comprehensive"
  }
}`;

      // ═══════════════════════════════════════════════════════════════
      // ROBUST CONTENT GENERATION WITH RETRY & FALLBACK
      // ═══════════════════════════════════════════════════════════════
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 1000; // ms
      
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      const parseAIResponse = (response) => {
        let jsonStr = response.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          // Try to fix common JSON issues
          let fixedJson = jsonStr
            .replace(/,\s*}/g, '}')
            .replace(/,\s*\]/g, ']')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\n/g, '\\n')
            .replace(/\t/g, '\\t');
          return JSON.parse(fixedJson);
        }
      };

      let preparedContent = null;
      let lastError = null;
      let retryCount = 0;

      while (retryCount < MAX_RETRIES && !preparedContent) {
        try {
          console.log(`[MIRA] Content generation attempt ${retryCount + 1}/${MAX_RETRIES} for ${templateType}...`);
          
          const aiResponse = await generateSmartContent(preparePrompt, {
            userId: user._id || user.userId,
            feature: 'whiteboard-prepare',
            skipRefinement: true
          });

          if (!aiResponse || aiResponse.trim().length === 0) {
            throw new Error('Empty response from AI');
          }

          preparedContent = parseAIResponse(aiResponse);
          
          // Validate the parsed content
          if (!preparedContent.sections || !Array.isArray(preparedContent.sections)) {
            throw new Error('Invalid content structure - missing sections array');
          }
          
          if (preparedContent.sections.length === 0) {
            throw new Error('Invalid content structure - empty sections');
          }
          
          // ═══════════════════════════════════════════════════════════════
          // VALIDATE ITEM COUNTS - Reject if too few items per section
          // ═══════════════════════════════════════════════════════════════
          const MIN_ITEMS_PER_SECTION = 8;
          const sectionsWithTooFewItems = preparedContent.sections.filter(
            s => (s.items?.length || 0) < MIN_ITEMS_PER_SECTION
          );
          
          if (sectionsWithTooFewItems.length > 0) {
            const itemCounts = preparedContent.sections.map(s => s.items?.length || 0);
            const avgItems = itemCounts.reduce((a, b) => a + b, 0) / itemCounts.length;
            
            // If average is below 7, reject and retry
            if (avgItems < 7) {
              console.warn(`[MIRA] Insufficient item density: avg ${avgItems.toFixed(1)} items/section. Sections: ${itemCounts.join(', ')}`);
              throw new Error(`Insufficient content depth - only ${avgItems.toFixed(1)} items per section on average. Need at least 8.`);
            } else {
              // Log warning but accept if average is reasonable
              console.warn(`[MIRA] Some sections have fewer than ${MIN_ITEMS_PER_SECTION} items: ${sectionsWithTooFewItems.map(s => `${s.title}: ${s.items?.length || 0}`).join(', ')}`);
            }
          }
          
          const totalItems = preparedContent.sections.reduce((sum, s) => sum + (s.items?.length || 0), 0);
          console.log(`[MIRA] Successfully generated content with ${preparedContent.sections.length} sections, ${totalItems} total items (avg ${(totalItems / preparedContent.sections.length).toFixed(1)}/section)`);
          
        } catch (error) {
          lastError = error;
          retryCount++;
          console.error(`[MIRA] Attempt ${retryCount} failed:`, error.message);
          
          if (retryCount < MAX_RETRIES) {
            console.log(`[MIRA] Retrying in ${RETRY_DELAY}ms...`);
            await sleep(RETRY_DELAY * retryCount); // Exponential backoff
          }
        }
      }

      // If all retries failed, return error
      if (!preparedContent) {
        console.error('[MIRA] All content generation attempts failed:', lastError);
        return NextResponse.json({
          error: `Failed to generate content after ${MAX_RETRIES} attempts. Please try rephrasing your request or try again later.`,
          details: lastError?.message || 'Unknown error'
        }, { status: 500 });
      }

      // ═══════════════════════════════════════════════════════════════
      // PROCESS SUCCESSFUL CONTENT
      // ═══════════════════════════════════════════════════════════════
      try {

        // Assign colors to sections if not provided
        const sectionColors = [
          { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700' },
          { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
          { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
          { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
          { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' },
          { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700' },
        ];

        if (preparedContent.sections) {
          preparedContent.sections = preparedContent.sections.map((section, idx) => ({
            ...section,
            color: section.color || sectionColors[idx % sectionColors.length]
          }));
        }

        // Add user prompt for history
        preparedContent.userPrompt = message;
        preparedContent.templateType = templateType;
        preparedContent.isPlotted = false;

        // Generate a unique ID for this preparation (not yet plotted)
        const prepareId = `prep-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        preparedContent.id = prepareId;

        // Store in whiteboard for persistence across sessions (legacy field)
        whiteboard.aiAnalysis.agentPreparedContent = preparedContent;
        
        // Also store in new agentContent structure for history
        if (!whiteboard.aiAnalysis.agentContent) {
          whiteboard.aiAnalysis.agentContent = {
            currentGenerationId: null,
            generations: []
          };
        }
        
        // Check if this is an update to existing unpotted content or new content
        const existingUnplottedIdx = whiteboard.aiAnalysis.agentContent.generations.findIndex(
          g => !g.isPlotted && g.templateType === templateType
        );
        
        const generationRecord = {
          id: prepareId,
          templateType,
          title: preparedContent.title || 'Untitled',
          description: preparedContent.description || '',
          sections: preparedContent.sections || [],
          conclusion: preparedContent.conclusion || '',
          userPrompt: message,
          isPlotted: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        if (existingUnplottedIdx >= 0) {
          // Update existing unplotted content
          whiteboard.aiAnalysis.agentContent.generations[existingUnplottedIdx] = generationRecord;
        } else {
          // Add new generation
          whiteboard.aiAnalysis.agentContent.generations.push(generationRecord);
        }
        whiteboard.aiAnalysis.agentContent.currentGenerationId = prepareId;
        
        whiteboard.aiAnalysis.messages.push(
          { role: 'user', content: `Prepare ${templateType}: ${message}`, timestamp: new Date() },
          { role: 'assistant', content: `I've prepared structured content for your ${templateType}. Review and customize it, then click "Start Plotting" when ready.`, timestamp: new Date() }
        );

        await whiteboard.save();

        return NextResponse.json({
          success: true,
          content: preparedContent,
          templateType,
          aiAnalysis: whiteboard.aiAnalysis,
          generationId: prepareId
        });

      } catch (processError) {
        console.error('[MIRA] Failed to process prepared content:', processError);
        return NextResponse.json({
          error: 'Failed to process generated content. The content was generated but could not be saved. Please try again.',
          details: processError?.message || 'Processing error'
        }, { status: 500 });
      }

    } else if (action === 'expand-section') {
      // Expand a section with more details
      const { sectionIndex, sectionTitle, currentContent, fullContext, templateType } = body;

      if (sectionIndex === undefined || !fullContext) {
        return NextResponse.json({ error: 'Section index and context required' }, { status: 400 });
      }

      const expandPrompt = `You are MIRA, expanding a section of a ${templateType || 'diagram'} with more details.

FULL CONTEXT:
Title: ${fullContext.title}
Description: ${fullContext.description}
Original Prompt: ${whiteboard.aiAnalysis.originalPrompt || 'Not available'}

SECTION TO EXPAND:
Title: ${sectionTitle}
Current Items: ${JSON.stringify(currentContent?.items || [])}
Current Summary: ${currentContent?.summary || 'None'}

Your task is to expand this section with:
1. More detailed items (add 3-5 new items)
2. Sub-points for existing items where helpful
3. A more comprehensive summary
4. Any relevant connections to other sections

You may ask clarifying questions if the user's intent is unclear - include them in a "questions" array.

Return ONLY this JSON structure:
{
  "type": "${currentContent?.type || 'expanded'}",
  "icon": "${currentContent?.icon || '📌'}",
  "title": "${sectionTitle}",
  "items": ["expanded item 1", "expanded item 2", ...],
  "subItems": {
    "item text": ["sub-point 1", "sub-point 2"]
  },
  "summary": "More comprehensive summary",
  "questions": ["Optional clarifying question 1"],
  "color": ${JSON.stringify(currentContent?.color || { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' })}
}`;

      try {
        const aiResponse = await generateSmartContent(expandPrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-expand-section',
          skipRefinement: true
        });

        let jsonStr = aiResponse.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        const expandedSection = JSON.parse(jsonStr);

        return NextResponse.json({
          success: true,
          expandedSection
        });

      } catch (parseError) {
        console.error('Failed to expand section:', parseError);
        return NextResponse.json({
          error: 'Failed to expand section. Try again.'
        }, { status: 400 });
      }

    } else if (action === 'regenerate-section') {
      // Regenerate a section with different approach
      const { sectionIndex, sectionTitle, originalPrompt, fullContext, templateType } = body;

      if (sectionIndex === undefined || !fullContext) {
        return NextResponse.json({ error: 'Section index and context required' }, { status: 400 });
      }

      const regeneratePrompt = `You are MIRA, regenerating a section of a ${templateType || 'diagram'} with a fresh approach.

FULL CONTEXT:
Title: ${fullContext.title}
Description: ${fullContext.description}
Original User Request: ${whiteboard.aiAnalysis.originalPrompt || originalPrompt || 'Not available'}

SECTION TO REGENERATE: "${sectionTitle}"

Other sections in the diagram:
${fullContext.sections?.filter((_, i) => i !== sectionIndex).map(s => `- ${s.title}: ${s.items?.slice(0, 2).join(', ')}...`).join('\n')}

Your task is to regenerate this section with:
1. A DIFFERENT approach or perspective than before
2. New, fresh items that still fit the context
3. Creative insights that add value
4. A new summary that ties to the overall theme

Think outside the box - what angle hasn't been explored yet?

Return ONLY this JSON structure:
{
  "type": "regenerated",
  "icon": "🔄",
  "title": "${sectionTitle}",
  "items": ["fresh item 1", "fresh item 2", ...],
  "summary": "New perspective on this section",
  "color": { "bg": "bg-violet-50", "border": "border-violet-200", "text": "text-violet-700" }
}`;

      try {
        const aiResponse = await generateSmartContent(regeneratePrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-regenerate-section',
          skipRefinement: true
        });

        let jsonStr = aiResponse.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        const regeneratedSection = JSON.parse(jsonStr);

        return NextResponse.json({
          success: true,
          regeneratedSection
        });

      } catch (parseError) {
        console.error('Failed to regenerate section:', parseError);
        return NextResponse.json({
          error: 'Failed to regenerate section. Try again.'
        }, { status: 400 });
      }

    } else if (action === 'edit-content') {
      // Edit content based on user's chat instruction
      const { editInstruction, currentContent, templateType } = body;

      if (!editInstruction || !currentContent) {
        return NextResponse.json({ error: 'Edit instruction and current content required' }, { status: 400 });
      }

      const editPrompt = `You are MIRA, editing structured diagram content based on user instructions.

CURRENT CONTENT:
${JSON.stringify(currentContent, null, 2)}

USER'S EDIT INSTRUCTION: "${editInstruction}"

Apply the user's requested changes to the content. You can:
1. Modify specific sections, items, or summaries
2. Add new items or sections
3. Remove items
4. Rephrase or reorganize content
5. Change the overall structure if requested

IMPORTANT: Maintain the same JSON structure, just update the content as requested.

Return ONLY the updated JSON structure (same format as input, but modified):
{
  "title": "...",
  "description": "...",
  "templateType": "${templateType}",
  "sections": [...],
  "conclusion": "...",
  "metadata": {...}
}`;

      try {
        const aiResponse = await generateSmartContent(editPrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-edit-content',
          skipRefinement: true
        });

        let jsonStr = aiResponse.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        const updatedContent = JSON.parse(jsonStr);

        // Update stored content
        whiteboard.aiAnalysis.preparedContent = updatedContent;
        whiteboard.aiAnalysis.messages.push(
          { role: 'user', content: editInstruction, timestamp: new Date() },
          { role: 'assistant', content: `I've updated the content as requested.`, timestamp: new Date() }
        );

        await whiteboard.save();

        return NextResponse.json({
          success: true,
          updatedContent
        });

      } catch (parseError) {
        console.error('Failed to edit content:', parseError);
        return NextResponse.json({
          error: 'Failed to edit content. Try rephrasing your instruction.'
        }, { status: 400 });
      }

    } else if (action === 'plot-from-content') {
      // Generate canvas objects from prepared content using COLLISION-AWARE SEQUENTIAL PLACEMENT
      const { preparedContent, templateType, targetPageIndex = 0 } = body;

      if (!preparedContent) {
        return NextResponse.json({ error: 'Prepared content required' }, { status: 400 });
      }

      // Validate targetPageIndex and ensure the page exists
      const pageIndex = Math.max(0, Math.min(targetPageIndex, whiteboard.pages.length - 1));
      
      // ═══════════════════════════════════════════════════════════════
      // REMOVE PREVIOUS MIRA-GENERATED ELEMENTS (for update/re-plot)
      // ═══════════════════════════════════════════════════════════════
      const existingObjects = whiteboard.pages[pageIndex]?.objects || [];
      
      // Check if this is an update (has previous generation ID or replaceExisting flag)
      const replaceExisting = body.replaceExisting !== false; // Default to true
      const previousGenerationId = body.previousGenerationId || preparedContent.id?.replace('prep-', 'gen-');
      
      // Filter out previous MIRA-generated elements
      let filteredObjects = existingObjects;
      if (replaceExisting) {
        // Remove ALL MIRA-generated elements (any element with id starting with 'mira-' or has generationId)
        const previousCount = existingObjects.length;
        filteredObjects = existingObjects.filter(obj => {
          // Keep if not a MIRA element
          const isMiraElement = obj.id?.startsWith('mira-') || obj.generationId;
          return !isMiraElement;
        });
        const removedCount = previousCount - filteredObjects.length;
        if (removedCount > 0) {
          console.log(`[MIRA] Removed ${removedCount} previous MIRA-generated elements from page ${pageIndex} for clean re-plot`);
        }
      }
      
      // Analyze layout from remaining (non-MIRA) objects
      const layout = analyzeLayout(filteredObjects);

      // Calculate starting position - if we removed elements, start fresh; otherwise offset
      const baseX = layout.hasContent ? Math.round(layout.bounds.maxX + 300) : 300;
      const baseY = layout.hasContent ? Math.round(layout.bounds.minY) : 300;

      // Light pastel color palette for AI-generated elements
      const SECTION_COLORS = [
        { fill: '#F5F3FF', stroke: '#A78BFA', text: '#6D28D9', light: '#FAF5FF' }, // Soft violet
        { fill: '#EFF6FF', stroke: '#93C5FD', text: '#1D4ED8', light: '#F0F9FF' }, // Soft blue
        { fill: '#ECFDF5', stroke: '#6EE7B7', text: '#047857', light: '#F0FDF4' }, // Soft emerald
        { fill: '#FFFBEB', stroke: '#FCD34D', text: '#B45309', light: '#FEFCE8' }, // Soft amber
        { fill: '#FDF2F8', stroke: '#F9A8D4', text: '#BE185D', light: '#FFF1F2' }, // Soft pink
        { fill: '#FFF7ED', stroke: '#FDBA74', text: '#C2410C', light: '#FFFAF0' }, // Soft orange
        { fill: '#EEF2FF', stroke: '#A5B4FC', text: '#4338CA', light: '#F5F3FF' }, // Soft indigo
        { fill: '#F0FDFA', stroke: '#5EEAD4', text: '#0F766E', light: '#ECFEFF' }, // Soft teal
      ];

      // Placed elements tracker for collision detection
      const placedElements = [];
      const contentElements = []; // Non-connector elements
      const connectorElements = []; // Arrows, lines - placed last
      const sectionMapping = {};
      let currentId = 0;

      const generateId = () => `mira-${Date.now()}-${currentId++}-${Math.random().toString(36).substr(2, 4)}`;

      // ========== COLLISION DETECTION SYSTEM ==========
      
      // Check if two rectangles overlap with padding
      const checkOverlap = (rect1, rect2, padding = 20) => {
        return !(
          rect1.x + rect1.width + padding < rect2.x ||
          rect2.x + rect2.width + padding < rect1.x ||
          rect1.y + rect1.height + padding < rect2.y ||
          rect2.y + rect2.height + padding < rect1.y
        );
      };

      // Check if a rectangle overlaps with any placed element
      const hasCollision = (rect, padding = 20) => {
        for (const placed of placedElements) {
          if (checkOverlap(rect, placed, padding)) {
            return true;
          }
        }
        return false;
      };

      // Find a valid position for an element, starting from preferred position
      const findValidPosition = (preferredX, preferredY, width, height, padding = 30) => {
        const rect = { x: preferredX, y: preferredY, width, height };
        
        // If no collision at preferred position, use it
        if (!hasCollision(rect, padding)) {
          return { x: preferredX, y: preferredY };
        }

        // Spiral outward to find valid position
        const spiralStep = 50;
        const maxAttempts = 100;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const radius = spiralStep * Math.ceil(attempt / 8);
          const angle = (attempt % 8) * (Math.PI / 4);
          
          const testX = preferredX + Math.cos(angle) * radius;
          const testY = preferredY + Math.sin(angle) * radius;
          
          const testRect = { x: testX, y: testY, width, height };
          if (!hasCollision(testRect, padding)) {
            return { x: testX, y: testY };
          }
        }

        // Fallback: place below all existing elements
        let maxY = preferredY;
        for (const placed of placedElements) {
          maxY = Math.max(maxY, placed.y + placed.height + padding);
        }
        return { x: preferredX, y: maxY + 50 };
      };

      // Place an element with collision detection
      // Ensures all coordinate values are proper numbers to prevent drag/resize issues
      const placeElement = (element, isConnector = false) => {
        // Normalize coordinates to ensure they're valid numbers
        const normalizedElement = {
          ...element,
          x: Number(element.x) || 0,
          y: Number(element.y) || 0,
          width: Number(element.width) || (element.type === 'text' ? 100 : element.type === 'sticky' ? 200 : 100),
          height: Number(element.height) || (element.type === 'text' ? 30 : element.type === 'sticky' ? 200 : 50),
        };
        
        // Normalize points array for connectors
        if (normalizedElement.points && Array.isArray(normalizedElement.points)) {
          normalizedElement.points = normalizedElement.points.map(p => ({
            ...p,
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
          }));
        }
        
        if (isConnector) {
          connectorElements.push(normalizedElement);
        } else {
          // Register the element's bounding box
          const bounds = {
            x: normalizedElement.x,
            y: normalizedElement.y,
            width: normalizedElement.width,
            height: normalizedElement.height,
            id: normalizedElement.id
          };
          placedElements.push(bounds);
          contentElements.push(normalizedElement);
        }
        return normalizedElement;
      };

      // ========== TEXT UTILITIES ==========
      
      const wrapText = (text, maxWidth, fontSize = 14) => {
        if (!text) return '';
        const avgCharWidth = fontSize * 0.52;
        const charsPerLine = Math.floor(maxWidth / avgCharWidth);
        const words = String(text).split(' ');
        const lines = [];
        let currentLine = '';
        
        words.forEach(word => {
          if ((currentLine + ' ' + word).trim().length <= charsPerLine) {
            currentLine = (currentLine + ' ' + word).trim();
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word.length > charsPerLine ? word.substring(0, charsPerLine - 2) + '...' : word;
          }
        });
        if (currentLine) lines.push(currentLine);
        
        return lines.slice(0, 6).join('\n'); // Max 6 lines
      };

      const calculateTextHeight = (text, fontSize = 14, lineHeight = 1.4) => {
        const lines = String(text).split('\n').length;
        return lines * fontSize * lineHeight + 20;
      };

      // ========== LAYOUT GENERATORS ==========
      
      const layoutGenerators = {
        // ========== MINDMAP LAYOUT ==========
        mindmap: () => {
          const sections = preparedContent.sections || [];
          const numSections = sections.length;
          if (numSections === 0) return;

          // Calculate layout dimensions
          const sectionSpacing = 400; // Horizontal spacing between sections
          const itemSpacing = 180;    // Vertical spacing between items
          const centerX = baseX + 400;
          const centerY = baseY + 300;

          // 1. PLACE CENTRAL TOPIC FIRST - PERFECT CIRCLE
          const titleText = preparedContent.title || 'Main Topic';
          const wrappedTitle = wrapText(titleText, 160, 16);  // Smaller wrap width for more padding
          const titleLines = wrappedTitle.split('\n').length;
          // Calculate circle size based on text - add generous padding
          const textHeight = titleLines * 16 * 1.4 + 60;
          const textWidth = 180;
          // Perfect circle: use the larger dimension with extra padding
          const centralSize = Math.max(textWidth + 60, textHeight + 40, 180);
          
          const centralPos = findValidPosition(centerX - centralSize/2, centerY - centralSize/2, centralSize, centralSize);
          const actualCenterX = centralPos.x + centralSize/2;
          const actualCenterY = centralPos.y + centralSize/2;

          // Store central node ID for connectors
          const centralNodeId = generateId();
          const centralGroupId = `central-${Date.now()}`;

          placeElement({
            id: centralNodeId,
            type: 'ellipse',
            x: centralPos.x,
            y: centralPos.y,
            width: centralSize,
            height: centralSize,  // Same as width for perfect circle
            fillColor: '#7C3AED',
            strokeColor: '#5B21B6',
            strokeWidth: 4,
            opacity: 1,
            groupId: centralGroupId
          });

          // For circular text: center text in the inscribed rectangle (60% of diameter for better padding)
          const inscribedSize = centralSize * 0.6;
          const textOffsetX = (centralSize - inscribedSize) / 2;
          const textOffsetY = (centralSize - inscribedSize) / 2;
          
          placeElement({
            id: generateId(),
            type: 'text',
            x: centralPos.x + textOffsetX,
            y: centralPos.y + textOffsetY,
            text: wrappedTitle,
            fontSize: 16,
            fontWeight: 'bold',
            fillColor: '#FFFFFF',
            width: inscribedSize,
            height: inscribedSize,
            textAlign: 'center',
            verticalAlign: 'middle',
            opacity: 1,
            groupId: centralGroupId
          });

          // Add description if exists
          if (preparedContent.description) {
            const descText = wrapText(preparedContent.description, 300, 12);
            const descHeight = calculateTextHeight(descText, 12);
            const descPos = findValidPosition(actualCenterX - 160, actualCenterY + centralSize/2 + 20, 320, descHeight);
            
            placeElement({
              id: generateId(),
              type: 'text',
              x: descPos.x,
              y: descPos.y,
              text: descText,
              fontSize: 12,
              fillColor: '#6B7280',
              width: 320,
              height: descHeight,
              textAlign: 'center',
              opacity: 0.9
            });
          }

          // 2. PLACE SECTION NODES IN A GRID-LIKE RADIAL PATTERN
          const sectionPositions = [];
          
          // Calculate section positions based on count
          const getOptimalSectionPositions = (count, centerX, centerY, radius) => {
            const positions = [];
            
            if (count <= 4) {
              // Cardinal directions for 4 or fewer
              const angles = [-Math.PI/2, 0, Math.PI/2, Math.PI]; // Top, Right, Bottom, Left
              for (let i = 0; i < count; i++) {
                positions.push({
                  angle: angles[i],
                  x: centerX + Math.cos(angles[i]) * radius,
                  y: centerY + Math.sin(angles[i]) * radius
                });
              }
            } else if (count <= 6) {
              // Hexagonal pattern
              for (let i = 0; i < count; i++) {
                const angle = (i * 2 * Math.PI / count) - Math.PI/2;
                positions.push({
                  angle,
                  x: centerX + Math.cos(angle) * radius,
                  y: centerY + Math.sin(angle) * radius
                });
              }
            } else {
              // Two rings for more sections
              const innerRadius = radius * 0.7;
              const outerRadius = radius * 1.2;
              const innerCount = Math.ceil(count / 2);
              const outerCount = count - innerCount;
              
              for (let i = 0; i < innerCount; i++) {
                const angle = (i * 2 * Math.PI / innerCount) - Math.PI/2;
                positions.push({
                  angle,
                  x: centerX + Math.cos(angle) * innerRadius,
                  y: centerY + Math.sin(angle) * innerRadius,
                  ring: 'inner'
                });
              }
              for (let i = 0; i < outerCount; i++) {
                const angle = (i * 2 * Math.PI / outerCount) - Math.PI/2 + Math.PI/outerCount;
                positions.push({
                  angle,
                  x: centerX + Math.cos(angle) * outerRadius,
                  y: centerY + Math.sin(angle) * outerRadius,
                  ring: 'outer'
                });
              }
            }
            
            return positions;
          };

          const optimalPositions = getOptimalSectionPositions(numSections, actualCenterX, actualCenterY, 380);

          sections.forEach((section, sectionIdx) => {
            const color = SECTION_COLORS[sectionIdx % SECTION_COLORS.length];
            const sectionIds = [];
            const optPos = optimalPositions[sectionIdx];
            
            // Section node dimensions - PERFECT CIRCLES with padding
            const sectionTitle = section.title || `Topic ${sectionIdx + 1}`;
            const wrappedSectionTitle = wrapText(sectionTitle, 90, 12);  // Smaller wrap width for padding
            const titleLines = wrappedSectionTitle.split('\n').length;
            const textHeight = titleLines * 12 * 1.4 + 40;
            // Perfect circle: use fixed size with extra padding
            const sectionSize = Math.max(140, textHeight + 30, 140);
            
            // Find valid position for section node
            const sectionPos = findValidPosition(
              optPos.x - sectionSize/2,
              optPos.y - sectionSize/2,
              sectionSize,
              sectionSize,
              40
            );
            
            const sectionCenterX = sectionPos.x + sectionSize/2;
            const sectionCenterY = sectionPos.y + sectionSize/2;
            
            sectionPositions.push({
              x: sectionCenterX,
              y: sectionCenterY,
              width: sectionSize,
              height: sectionSize,
              color
            });

            // Place section ellipse (perfect circle) with groupId
            const sectionGroupId = `section-${sectionIdx}-${Date.now()}`;
            const sectionNodeId = generateId();
            sectionIds.push(sectionNodeId);
            placeElement({
              id: sectionNodeId,
              type: 'ellipse',
              x: sectionPos.x,
              y: sectionPos.y,
              width: sectionSize,
              height: sectionSize,  // Same as width for perfect circle
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 3,
              opacity: 1,
              groupId: sectionGroupId
            });

            // Place section title inside circle - use inscribed rectangle (60% for better padding)
            const inscribedSize = sectionSize * 0.6;
            const textOffsetX = (sectionSize - inscribedSize) / 2;
            const textOffsetY = (sectionSize - inscribedSize) / 2;
            
            placeElement({
              id: generateId(),
              type: 'text',
              x: sectionPos.x + textOffsetX,
              y: sectionPos.y + textOffsetY,
              text: wrappedSectionTitle,
              fontSize: 12,
              fontWeight: 'bold',
              fillColor: color.text,
              width: inscribedSize,
              height: inscribedSize,
              textAlign: 'center',
              verticalAlign: 'middle',
              opacity: 1,
              groupId: sectionGroupId
            });

            // 3. PLACE ALL ITEMS FOR THIS SECTION - NO LIMIT
            const items = section.items || [];
            const itemCount = items.length; // No limit - use all items
            
            if (itemCount > 0) {
              // Determine item placement direction based on section position
              const angleFromCenter = Math.atan2(sectionCenterY - actualCenterY, sectionCenterX - actualCenterX);
              
              // Items fan out in direction away from center - expand spread for more items
              const spreadAngle = Math.min(Math.PI / 2, Math.PI / 6 + (itemCount * Math.PI / 40));
              const itemStartAngle = angleFromCenter - spreadAngle / 2;
              const itemEndAngle = angleFromCenter + spreadAngle / 2;
              const itemAngleStep = itemCount > 1 ? (itemEndAngle - itemStartAngle) / (itemCount - 1) : 0;
              
              // Place items in expanding rings if there are many
              const itemsPerRing = 8;
              items.forEach((item, itemIdx) => {
                const itemText = wrapText(item, 180, 13);
                const stickyWidth = 200;
                const stickyHeight = Math.max(90, calculateTextHeight(itemText, 13) + 30);
                
                // Calculate ring and position within ring
                const ring = Math.floor(itemIdx / itemsPerRing);
                const posInRing = itemIdx % itemsPerRing;
                const ringItemCount = Math.min(itemsPerRing, itemCount - ring * itemsPerRing);
                
                // Calculate preferred position with expanding rings
                const ringAngleStep = ringItemCount > 1 ? (itemEndAngle - itemStartAngle) / (ringItemCount - 1) : 0;
                const itemAngle = ringItemCount === 1 ? angleFromCenter : itemStartAngle + ringAngleStep * posInRing;
                const itemDistance = 200 + ring * 120 + (posInRing % 2) * 40; // Expand outward for each ring
                const preferredX = sectionCenterX + Math.cos(itemAngle) * itemDistance - stickyWidth/2;
                const preferredY = sectionCenterY + Math.sin(itemAngle) * itemDistance - stickyHeight/2;
                
                // Find valid position
                const itemPos = findValidPosition(preferredX, preferredY, stickyWidth, stickyHeight, 25);
                
                const itemId = generateId();
                sectionIds.push(itemId);
                placeElement({
                  id: itemId,
                  type: 'sticky',
                  x: itemPos.x,
                  y: itemPos.y,
                  width: stickyWidth,
                  height: stickyHeight,
                  text: itemText,
                  fillColor: color.light,
                  strokeColor: color.stroke,
                  strokeWidth: 1,
                  borderRadius: 12,
                  fontSize: 13,
                  opacity: 1
                });

                // Queue connector from section to item (placed later) - using dynamic connector
                const itemCenterX = itemPos.x + stickyWidth/2;
                const itemCenterY = itemPos.y + stickyHeight/2;
                
                connectorElements.push({
                  id: generateId(),
                  type: 'connector',
                  startElementId: sectionNodeId,
                  endElementId: itemId,
                  startPoint: { x: sectionCenterX, y: sectionCenterY, edge: 'auto' },
                  endPoint: { x: itemCenterX, y: itemCenterY, edge: 'auto' },
                  points: [
                    { x: sectionCenterX, y: sectionCenterY },
                    { x: itemCenterX, y: itemCenterY }
                  ],
                  strokeColor: color.stroke,
                  strokeWidth: 1.5,
                  lineStyle: 'solid',
                  connectorStyle: 'bezier',
                  curvature: 0.5,
                  opacity: 0.5
                });
              });
            }

            // Add section summary if available
            if (section.summary) {
              const summaryText = wrapText(section.summary, 180, 11);
              const summaryHeight = calculateTextHeight(summaryText, 11);
              const summaryPos = findValidPosition(
                sectionCenterX - 100,
                sectionPos.y + sectionSize + 10,
                200,
                summaryHeight
              );
              
              placeElement({
                id: generateId(),
                type: 'text',
                x: summaryPos.x,
                y: summaryPos.y,
                text: summaryText,
                fontSize: 11,
                fontStyle: 'italic',
                fillColor: color.text,
                width: 200,
                height: summaryHeight,
                textAlign: 'center',
                opacity: 0.7
              });
            }

            sectionMapping[sectionIdx] = sectionIds;
          });

          // 4. PLACE CONNECTORS FROM CENTER TO SECTIONS - using dynamic connector type
          sectionPositions.forEach((sectionPos, idx) => {
            connectorElements.push({
              id: generateId(),
              type: 'connector',
              startElementId: centralNodeId,
              endElementId: sectionMapping[idx]?.[0] || null,
              startPoint: { x: actualCenterX, y: actualCenterY, edge: 'auto' },
              endPoint: { x: sectionPos.x, y: sectionPos.y, edge: 'auto' },
              points: [
                { x: actualCenterX, y: actualCenterY },
                { x: sectionPos.x, y: sectionPos.y }
              ],
              strokeColor: sectionPos.color.stroke,
              strokeWidth: 2,
              connectorStyle: 'bezier',
              curvature: 0.5,
              opacity: 0.7
            });
          });

          // 5. PLACE CONCLUSION
          if (preparedContent.conclusion) {
            const conclusionText = wrapText(preparedContent.conclusion, 320, 14);
            const conclusionWidth = 360;
            const conclusionHeight = Math.max(100, calculateTextHeight(conclusionText, 14) + 50);
            
            // Place below everything
            let maxY = actualCenterY;
            for (const placed of placedElements) {
              maxY = Math.max(maxY, placed.y + placed.height);
            }
            
            const conclusionPos = findValidPosition(actualCenterX - conclusionWidth/2, maxY + 60, conclusionWidth, conclusionHeight);
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: conclusionPos.x,
              y: conclusionPos.y,
              width: conclusionWidth,
              height: conclusionHeight,
              text: `Key Insight\n\n${conclusionText}`,
              fillColor: '#FEF3C7',
              strokeColor: '#F59E0B',
              strokeWidth: 2,
              borderRadius: 16,
              fontSize: 14,
              opacity: 1
            });
          }
        },

        // ========== FLOWCHART LAYOUT ==========
        flowchart: () => {
          const sections = preparedContent.sections || [];
          if (sections.length === 0) return;

          const stepWidth = 220;
          const stepHeight = 90;
          const gapY = 120;
          const branchOffsetX = 300;
          
          let currentY = baseY;
          let mainFlowX = baseX + 400;

          // 1. PLACE TITLE
          const titleText = preparedContent.title || 'Process Flow';
          const wrappedTitle = wrapText(titleText, 350, 22);
          const titlePos = findValidPosition(mainFlowX - 200, currentY, 400, 50);
          
          placeElement({
            id: generateId(),
            type: 'text',
            x: titlePos.x,
            y: titlePos.y,
            text: wrappedTitle,
            fontSize: 22,
            fontWeight: 'bold',
            fillColor: '#1F2937',
            width: 400,
            height: 50,
            opacity: 1
          });
          currentY += 80;

          // 2. PLACE START NODE
          const startWidth = 140;
          const startHeight = 60;
          const startPos = findValidPosition(mainFlowX - startWidth/2, currentY, startWidth, startHeight);
          const startCenterX = startPos.x + startWidth/2;
          const startCenterY = startPos.y + startHeight/2;
          
          // Store start node ID for connectors
          const startNodeId = generateId();
          const startGroupId = `start-${Date.now()}`;
          
          placeElement({
            id: startNodeId,
            type: 'ellipse',
            x: startPos.x,
            y: startPos.y,
            width: startWidth,
            height: startHeight,
            fillColor: '#D1FAE5',
            strokeColor: '#10B981',
            strokeWidth: 3,
            opacity: 1,
            groupId: startGroupId
          });

          placeElement({
            id: generateId(),
            type: 'text',
            x: startPos.x + 20,
            y: startPos.y + 18,
            text: 'Start',
            fontSize: 16,
            fontWeight: 'bold',
            fillColor: '#065F46',
            width: startWidth - 40,
            height: 24,
            textAlign: 'center',
            opacity: 1,
            groupId: startGroupId
          });

          currentY = startPos.y + startHeight + gapY/2;
          let prevElementId = startNodeId;
          let prevCenterX = startCenterX;
          let prevBottomY = startPos.y + startHeight;

          // 3. PLACE EACH SECTION AS A STEP
          const stepPositions = [];

          sections.forEach((section, sectionIdx) => {
            const color = SECTION_COLORS[sectionIdx % SECTION_COLORS.length];
            const sectionIds = [];
            const isDecision = section.type === 'decisions' || section.title?.toLowerCase().includes('decision');
            
            if (isDecision) {
              // DECISION DIAMOND
              const diamondSize = 140;
              const diamondPos = findValidPosition(mainFlowX - diamondSize/2, currentY, diamondSize, diamondSize);
              const diamondCenterX = diamondPos.x + diamondSize/2;
              const diamondCenterY = diamondPos.y + diamondSize/2;
              
              const decisionId = generateId();
              sectionIds.push(decisionId);
              
              placeElement({
                id: decisionId,
                type: 'diamond',
                x: diamondPos.x,
                y: diamondPos.y,
                width: diamondSize,
                height: diamondSize,
                fillColor: color.fill,
                strokeColor: color.stroke,
                strokeWidth: 3,
                opacity: 1
              });

              const decisionTitle = wrapText(section.title || 'Decision', 100, 12);
              placeElement({
                id: generateId(),
                type: 'text',
                x: diamondPos.x + 20,
                y: diamondPos.y + diamondSize/2 - 15,
                text: decisionTitle,
                fontSize: 12,
                fontWeight: 'bold',
                fillColor: color.text,
                width: diamondSize - 40,
                height: 30,
                textAlign: 'center',
                opacity: 1
              });

              // Dynamic connector from previous element to decision
              connectorElements.push({
                id: generateId(),
                type: 'connector',
                startElementId: prevElementId,
                endElementId: decisionId,
                startPoint: { x: prevCenterX, y: prevBottomY, edge: 'bottom' },
                endPoint: { x: diamondCenterX, y: diamondPos.y, edge: 'top' },
                points: [
                  { x: prevCenterX, y: prevBottomY },
                  { x: diamondCenterX, y: diamondPos.y }
                ],
                strokeColor: '#64748B',
                strokeWidth: 2,
                connectorStyle: 'bezier',
                curvature: 0.3,
                arrowEnd: true,
                opacity: 1
              });

              // Branch items (Yes/No paths)
              const items = section.items || ['Yes path', 'No path'];
              
              // Yes branch (right)
              if (items[0]) {
                const yesBranchText = wrapText(items[0], 140, 12);
                const yesWidth = 160;
                const yesHeight = Math.max(70, calculateTextHeight(yesBranchText, 12) + 20);
                const yesPos = findValidPosition(diamondCenterX + branchOffsetX - yesWidth/2, diamondCenterY - yesHeight/2, yesWidth, yesHeight);
                
                const yesId = generateId();
                sectionIds.push(yesId);
                placeElement({
                  id: yesId,
                  type: 'sticky',
                  x: yesPos.x,
                  y: yesPos.y,
                  width: yesWidth,
                  height: yesHeight,
                  text: yesBranchText,
                  fillColor: '#D1FAE5',
                  strokeColor: '#10B981',
                  borderRadius: 8,
                  opacity: 1
                });

                // Yes connector (dynamic)
                connectorElements.push({
                  id: generateId(),
                  type: 'connector',
                  startElementId: decisionId,
                  endElementId: yesId,
                  startPoint: { x: diamondPos.x + diamondSize, y: diamondCenterY, edge: 'right' },
                  endPoint: { x: yesPos.x, y: yesPos.y + yesHeight/2, edge: 'left' },
                  points: [
                    { x: diamondPos.x + diamondSize, y: diamondCenterY },
                    { x: yesPos.x, y: yesPos.y + yesHeight/2 }
                  ],
                  strokeColor: '#10B981',
                  strokeWidth: 2,
                  connectorStyle: 'bezier',
                  curvature: 0.3,
                  arrowEnd: true,
                  opacity: 1
                });

                // Yes label
                placeElement({
                  id: generateId(),
                  type: 'text',
                  x: diamondPos.x + diamondSize + 10,
                  y: diamondCenterY - 20,
                  text: 'Yes',
                  fontSize: 12,
                  fontWeight: 'bold',
                  fillColor: '#10B981',
                  width: 40,
                  height: 20,
                  opacity: 1
                });
              }

              // No branch (left)
              if (items[1]) {
                const noBranchText = wrapText(items[1], 140, 12);
                const noWidth = 160;
                const noHeight = Math.max(70, calculateTextHeight(noBranchText, 12) + 20);
                const noPos = findValidPosition(diamondCenterX - branchOffsetX - noWidth/2, diamondCenterY - noHeight/2, noWidth, noHeight);
                
                const noId = generateId();
                sectionIds.push(noId);
                placeElement({
                  id: noId,
                  type: 'sticky',
                  x: noPos.x,
                  y: noPos.y,
                  width: noWidth,
                  height: noHeight,
                  text: noBranchText,
                  fillColor: '#FCE7F3',
                  strokeColor: '#EC4899',
                  borderRadius: 8,
                  opacity: 1
                });

                // No connector (dynamic)
                connectorElements.push({
                  id: generateId(),
                  type: 'connector',
                  startElementId: decisionId,
                  endElementId: noId,
                  startPoint: { x: diamondPos.x, y: diamondCenterY, edge: 'left' },
                  endPoint: { x: noPos.x + noWidth, y: noPos.y + noHeight/2, edge: 'right' },
                  points: [
                    { x: diamondPos.x, y: diamondCenterY },
                    { x: noPos.x + noWidth, y: noPos.y + noHeight/2 }
                  ],
                  strokeColor: '#EC4899',
                  strokeWidth: 2,
                  connectorStyle: 'bezier',
                  curvature: 0.3,
                  arrowEnd: true,
                  opacity: 1
                });

                // No label
                placeElement({
                  id: generateId(),
                  type: 'text',
                  x: diamondPos.x - 50,
                  y: diamondCenterY - 20,
                  text: 'No',
                  fontSize: 12,
                  fontWeight: 'bold',
                  fillColor: '#EC4899',
                  width: 40,
                  height: 20,
                  opacity: 1
                });
              }

              prevElementId = decisionId;
              prevCenterX = diamondCenterX;
              prevBottomY = diamondPos.y + diamondSize;
              currentY = prevBottomY + gapY;
              
              stepPositions.push({ x: diamondCenterX, y: diamondCenterY, type: 'decision' });
            } else {
              // REGULAR PROCESS STEP
              const stepTitle = section.title || `Step ${sectionIdx + 1}`;
              const wrappedStepTitle = wrapText(stepTitle, stepWidth - 40, 14);
              const actualHeight = Math.max(stepHeight, calculateTextHeight(wrappedStepTitle, 14) + 30);
              
              const stepPos = findValidPosition(mainFlowX - stepWidth/2, currentY, stepWidth, actualHeight);
              const stepCenterX = stepPos.x + stepWidth/2;
              const stepCenterY = stepPos.y + actualHeight/2;
              
              const stepId = generateId();
              sectionIds.push(stepId);
              
              placeElement({
                id: stepId,
                type: 'rect',
                x: stepPos.x,
                y: stepPos.y,
                width: stepWidth,
                height: actualHeight,
                fillColor: color.fill,
                strokeColor: color.stroke,
                strokeWidth: 2,
                borderRadius: 12,
                opacity: 1
              });

              placeElement({
                id: generateId(),
                type: 'text',
                x: stepPos.x + 15,
                y: stepPos.y + actualHeight/2 - 10,
                text: wrappedStepTitle,
                fontSize: 14,
                fontWeight: 'bold',
                fillColor: color.text,
                width: stepWidth - 30,
                height: actualHeight - 20,
                textAlign: 'center',
                opacity: 1
              });

              // Dynamic connector from previous element
              connectorElements.push({
                id: generateId(),
                type: 'connector',
                startElementId: prevElementId,
                endElementId: stepId,
                startPoint: { x: prevCenterX, y: prevBottomY, edge: 'bottom' },
                endPoint: { x: stepCenterX, y: stepPos.y, edge: 'top' },
                points: [
                  { x: prevCenterX, y: prevBottomY },
                  { x: stepCenterX, y: stepPos.y }
                ],
                strokeColor: '#64748B',
                strokeWidth: 2,
                connectorStyle: 'bezier',
                curvature: 0.3,
                arrowEnd: true,
                opacity: 1
              });

              // Place step items to the side - NO LIMIT, dynamically position all items
              const items = section.items || [];
              if (items.length > 0) {
                items.forEach((item, itemIdx) => {
                  const itemText = wrapText(item, 160, 12);
                  const itemWidth = 180;
                  const itemHeight = Math.max(60, calculateTextHeight(itemText, 12) + 15);
                  const side = itemIdx % 2 === 0 ? 1 : -1;
                  const row = Math.floor(itemIdx / 2);
                  const offsetY = row * (itemHeight + 15);
                  
                  const itemPos = findValidPosition(
                    stepCenterX + side * (stepWidth/2 + 80) - itemWidth/2,
                    stepPos.y + offsetY,
                    itemWidth,
                    itemHeight
                  );
                  
                  const itemId = generateId();
                  sectionIds.push(itemId);
                  placeElement({
                    id: itemId,
                    type: 'sticky',
                    x: itemPos.x,
                    y: itemPos.y,
                    width: itemWidth,
                    height: itemHeight,
                    text: itemText,
                    fillColor: color.light,
                    strokeColor: color.stroke,
                    borderRadius: 8,
                    fontSize: 12,
                    opacity: 1
                  });

                  connectorElements.push({
                    id: generateId(),
                    type: 'connector',
                    startElementId: stepId,
                    endElementId: itemId,
                    startPoint: { x: stepCenterX + side * stepWidth/2, y: stepCenterY, edge: side > 0 ? 'right' : 'left' },
                    endPoint: { x: itemPos.x + (side > 0 ? 0 : itemWidth), y: itemPos.y + itemHeight/2, edge: side > 0 ? 'left' : 'right' },
                    points: [
                      { x: stepCenterX + side * stepWidth/2, y: stepCenterY },
                      { x: itemPos.x + (side > 0 ? 0 : itemWidth), y: itemPos.y + itemHeight/2 }
                    ],
                    strokeColor: color.stroke,
                    strokeWidth: 1,
                    lineStyle: 'dashed',
                    connectorStyle: 'bezier',
                    curvature: 0.3,
                    opacity: 0.5
                  });
                });
              }

              prevElementId = stepId;
              prevCenterX = stepCenterX;
              prevBottomY = stepPos.y + actualHeight;
              currentY = prevBottomY + gapY;
              
              stepPositions.push({ x: stepCenterX, y: stepCenterY, type: 'step' });
            }

            sectionMapping[sectionIdx] = sectionIds;
          });

          // 4. PLACE END NODE
          const endWidth = 140;
          const endHeight = 60;
          const endPos = findValidPosition(mainFlowX - endWidth/2, currentY, endWidth, endHeight);
          
          // Store end node ID
          const endNodeId = generateId();
          const endGroupId = `end-${Date.now()}`;
          
          placeElement({
            id: endNodeId,
            type: 'ellipse',
            x: endPos.x,
            y: endPos.y,
            width: endWidth,
            height: endHeight,
            fillColor: '#FEE2E2',
            strokeColor: '#EF4444',
            strokeWidth: 3,
            opacity: 1,
            groupId: endGroupId
          });

          placeElement({
            id: generateId(),
            type: 'text',
            x: endPos.x + 20,
            y: endPos.y + 18,
            text: 'End',
            fontSize: 16,
            fontWeight: 'bold',
            fillColor: '#991B1B',
            width: endWidth - 40,
            height: 24,
            textAlign: 'center',
            opacity: 1,
            groupId: endGroupId
          });

          // Dynamic connector to end
          connectorElements.push({
            id: generateId(),
            type: 'connector',
            startElementId: prevElementId,
            endElementId: endNodeId,
            startPoint: { x: prevCenterX, y: prevBottomY, edge: 'bottom' },
            endPoint: { x: endPos.x + endWidth/2, y: endPos.y, edge: 'top' },
            points: [
              { x: prevCenterX, y: prevBottomY },
              { x: endPos.x + endWidth/2, y: endPos.y }
            ],
            strokeColor: '#64748B',
            strokeWidth: 2,
            connectorStyle: 'bezier',
            curvature: 0.3,
            arrowEnd: true,
            opacity: 1
          });

          // 5. PLACE CONCLUSION
          if (preparedContent.conclusion) {
            const conclusionText = wrapText(preparedContent.conclusion, 300, 13);
            const conclusionWidth = 340;
            const conclusionHeight = Math.max(80, calculateTextHeight(conclusionText, 13) + 40);
            const conclusionPos = findValidPosition(mainFlowX - conclusionWidth/2, endPos.y + endHeight + 50, conclusionWidth, conclusionHeight);
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: conclusionPos.x,
              y: conclusionPos.y,
              width: conclusionWidth,
              height: conclusionHeight,
              text: `Summary\n\n${conclusionText}`,
              fillColor: '#FEF3C7',
              strokeColor: '#F59E0B',
              borderRadius: 12,
              fontSize: 13,
              opacity: 1
            });
          }
        },

        // ========== PLANNING/KANBAN LAYOUT ==========
        planning: () => {
          const sections = preparedContent.sections || [];
          if (sections.length === 0) return;

          const columnWidth = 280;
          const columnGap = 40;
          const cardHeight = 80;
          const cardGap = 20;

          // 1. PLACE TITLE
          const titleText = preparedContent.title || 'Project Plan';
          const totalWidth = sections.length * columnWidth + (sections.length - 1) * columnGap;
          const titlePos = findValidPosition(baseX, baseY, totalWidth, 50);
          
          placeElement({
            id: generateId(),
            type: 'text',
            x: titlePos.x,
            y: titlePos.y,
            text: titleText,
            fontSize: 24,
            fontWeight: 'bold',
            fillColor: '#1F2937',
            width: totalWidth,
            height: 50,
            opacity: 1
          });

          let startY = titlePos.y + 80;

          // 2. PLACE EACH COLUMN
          sections.forEach((section, sectionIdx) => {
            const color = SECTION_COLORS[sectionIdx % SECTION_COLORS.length];
            const sectionIds = [];
            const columnX = baseX + sectionIdx * (columnWidth + columnGap);
            let currentCardY = startY;

            // Column header
            const headerHeight = 50;
            const headerPos = findValidPosition(columnX, startY, columnWidth, headerHeight);
            
            const headerId = generateId();
            sectionIds.push(headerId);
            placeElement({
              id: headerId,
              type: 'rect',
              x: headerPos.x,
              y: headerPos.y,
              width: columnWidth,
              height: headerHeight,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 2,
              borderRadius: 8,
              opacity: 1
            });

            placeElement({
              id: generateId(),
              type: 'text',
              x: headerPos.x + 15,
              y: headerPos.y + 15,
              text: section.title || `Column ${sectionIdx + 1}`,
              fontSize: 16,
              fontWeight: 'bold',
              fillColor: color.text,
              width: columnWidth - 30,
              height: 24,
              opacity: 1
            });

            currentCardY = headerPos.y + headerHeight + cardGap;

            // Column cards
            const items = section.items || [];
            items.forEach((item, itemIdx) => {
              const cardText = wrapText(item, columnWidth - 30, 12);
              const actualCardHeight = Math.max(cardHeight, calculateTextHeight(cardText, 12) + 25);
              const cardPos = findValidPosition(columnX, currentCardY, columnWidth, actualCardHeight);
              
              const cardId = generateId();
              sectionIds.push(cardId);
              placeElement({
                id: cardId,
                type: 'sticky',
                x: cardPos.x,
                y: cardPos.y,
                width: columnWidth,
                height: actualCardHeight,
                text: cardText,
                fillColor: '#FFFFFF',
                strokeColor: color.stroke,
                strokeWidth: 1,
                borderRadius: 8,
                fontSize: 12,
                opacity: 1
              });

              currentCardY = cardPos.y + actualCardHeight + cardGap;
            });

            // Summary at bottom of column
            if (section.summary) {
              const summaryText = wrapText(section.summary, columnWidth - 20, 11);
              const summaryHeight = calculateTextHeight(summaryText, 11) + 10;
              const summaryPos = findValidPosition(columnX, currentCardY, columnWidth, summaryHeight);
              
              placeElement({
                id: generateId(),
                type: 'text',
                x: summaryPos.x,
                y: summaryPos.y,
                text: summaryText,
                fontSize: 11,
                fontStyle: 'italic',
                fillColor: color.text,
                width: columnWidth,
                height: summaryHeight,
                textAlign: 'center',
                opacity: 0.7
              });
            }

            sectionMapping[sectionIdx] = sectionIds;
          });

          // 3. PLACE CONCLUSION
          if (preparedContent.conclusion) {
            let maxY = startY;
            for (const placed of placedElements) {
              maxY = Math.max(maxY, placed.y + placed.height);
            }

            const conclusionText = wrapText(preparedContent.conclusion, totalWidth - 40, 14);
            const conclusionHeight = calculateTextHeight(conclusionText, 14) + 30;
            const conclusionPos = findValidPosition(baseX, maxY + 40, totalWidth, conclusionHeight);
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: conclusionPos.x,
              y: conclusionPos.y,
              width: totalWidth,
              height: conclusionHeight,
              text: `Key Objective: ${conclusionText}`,
              fillColor: '#EDE9FE',
              strokeColor: '#8B5CF6',
              borderRadius: 12,
              fontSize: 14,
              opacity: 1
            });
          }
        },

        // ========== IDEAS/BRAINSTORM LAYOUT ==========
        ideas: () => {
          const sections = preparedContent.sections || [];
          if (sections.length === 0) return;

          const centerX = baseX + 500;
          const centerY = baseY + 400;

          // 1. PLACE CENTRAL THEME
          const titleText = preparedContent.title || 'Brainstorm';
          const wrappedTitle = wrapText(titleText, 200, 18);
          const centralWidth = 260;
          const centralHeight = Math.max(120, calculateTextHeight(wrappedTitle, 18) + 50);
          
          const centralPos = findValidPosition(centerX - centralWidth/2, centerY - centralHeight/2, centralWidth, centralHeight);
          const actualCenterX = centralPos.x + centralWidth/2;
          const actualCenterY = centralPos.y + centralHeight/2;

          // Store central theme ID for connectors
          const centralThemeId = generateId();
          
          placeElement({
            id: centralThemeId,
            type: 'sticky',
            x: centralPos.x,
            y: centralPos.y,
            width: centralWidth,
            height: centralHeight,
            text: wrappedTitle,
            fillColor: '#FEF3C7',
            strokeColor: '#F59E0B',
            strokeWidth: 3,
            borderRadius: 16,
            fontSize: 18,
            fontWeight: 'bold',
            opacity: 1
          });

          // 2. PLACE SECTIONS AS CLUSTERS AROUND CENTER
          const clusterRadius = 350;
          const angleStep = (2 * Math.PI) / Math.max(sections.length, 1);

          sections.forEach((section, sectionIdx) => {
            const color = SECTION_COLORS[sectionIdx % SECTION_COLORS.length];
            const sectionIds = [];
            const angle = angleStep * sectionIdx - Math.PI/2;
            
            // Section header position
            const sectionX = actualCenterX + Math.cos(angle) * clusterRadius;
            const sectionY = actualCenterY + Math.sin(angle) * clusterRadius;
            
            const sectionTitle = section.title || `Category ${sectionIdx + 1}`;
            const wrappedSectionTitle = wrapText(sectionTitle, 160, 14);
            const sectionWidth = 180;
            const sectionHeight = Math.max(70, calculateTextHeight(wrappedSectionTitle, 14) + 25);
            
            const sectionPos = findValidPosition(sectionX - sectionWidth/2, sectionY - sectionHeight/2, sectionWidth, sectionHeight, 50);
            const sectionCenterX = sectionPos.x + sectionWidth/2;
            const sectionCenterY = sectionPos.y + sectionHeight/2;

            // Section shape (alternate shapes for variety)
            const shapes = ['ellipse', 'diamond', 'hexagon'];
            const shapeType = shapes[sectionIdx % shapes.length];
            
            const sectionShapeId = generateId();
            sectionIds.push(sectionShapeId);
            
            placeElement({
              id: sectionShapeId,
              type: shapeType,
              x: sectionPos.x,
              y: sectionPos.y,
              width: sectionWidth,
              height: sectionHeight,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 2,
              opacity: 1
            });

            placeElement({
              id: generateId(),
              type: 'text',
              x: sectionPos.x + 15,
              y: sectionPos.y + sectionHeight/2 - 10,
              text: wrappedSectionTitle,
              fontSize: 14,
              fontWeight: 'bold',
              fillColor: color.text,
              width: sectionWidth - 30,
              height: 24,
              textAlign: 'center',
              opacity: 1
            });

            // Dynamic connector to center
            connectorElements.push({
              id: generateId(),
              type: 'connector',
              startElementId: centralThemeId,
              endElementId: sectionShapeId,
              startPoint: { x: actualCenterX, y: actualCenterY, edge: 'auto' },
              endPoint: { x: sectionCenterX, y: sectionCenterY, edge: 'auto' },
              points: [
                { x: actualCenterX, y: actualCenterY },
                { x: sectionCenterX, y: sectionCenterY }
              ],
              strokeColor: color.stroke,
              strokeWidth: 2,
              lineStyle: 'dashed',
              connectorStyle: 'bezier',
              curvature: 0.4,
              opacity: 0.5
            });

            // 3. PLACE ALL ITEMS SCATTERED AROUND SECTION - NO LIMIT
            const items = section.items || [];
            const itemCount = items.length;
            
            // Expand radius and angle spread for more items
            const itemsPerRing = 6;
            const baseRadius = 160;
            
            items.forEach((item, itemIdx) => {
              const itemText = wrapText(item, 150, 12);
              const itemWidth = 170;
              const itemHeight = Math.max(70, calculateTextHeight(itemText, 12) + 20);
              
              // Calculate ring and position
              const ring = Math.floor(itemIdx / itemsPerRing);
              const posInRing = itemIdx % itemsPerRing;
              const ringItemCount = Math.min(itemsPerRing, itemCount - ring * itemsPerRing);
              
              // Calculate angle and radius
              const ringAngleSpread = Math.PI * 0.7;
              const ringStartAngle = angle - ringAngleSpread / 2;
              const ringAngleStep = ringItemCount > 1 ? ringAngleSpread / (ringItemCount - 1) : 0;
              const itemAngle = ringItemCount === 1 ? angle : ringStartAngle + ringAngleStep * posInRing;
              const itemRadius = baseRadius + ring * 100;
              
              const preferredX = sectionCenterX + Math.cos(itemAngle) * itemRadius - itemWidth/2;
              const preferredY = sectionCenterY + Math.sin(itemAngle) * itemRadius - itemHeight/2;
              
              const itemPos = findValidPosition(preferredX, preferredY, itemWidth, itemHeight, 20);
              
              const itemId = generateId();
              sectionIds.push(itemId);
              placeElement({
                id: itemId,
                type: 'sticky',
                x: itemPos.x,
                y: itemPos.y,
                width: itemWidth,
                height: itemHeight,
                text: itemText,
                fillColor: color.light,
                strokeColor: color.stroke,
                borderRadius: 10,
                fontSize: 12,
                opacity: 1
              });

              // Dynamic connector to section
              connectorElements.push({
                id: generateId(),
                type: 'connector',
                startElementId: sectionShapeId,
                endElementId: itemId,
                startPoint: { x: sectionCenterX, y: sectionCenterY, edge: 'auto' },
                endPoint: { x: itemPos.x + itemWidth/2, y: itemPos.y + itemHeight/2, edge: 'auto' },
                points: [
                  { x: sectionCenterX, y: sectionCenterY },
                  { x: itemPos.x + itemWidth/2, y: itemPos.y + itemHeight/2 }
                ],
                strokeColor: color.stroke,
                strokeWidth: 1,
                lineStyle: 'dotted',
                connectorStyle: 'bezier',
                curvature: 0.4,
                opacity: 0.4
              });
            });

            sectionMapping[sectionIdx] = sectionIds;
          });

          // 4. PLACE CONCLUSION
          if (preparedContent.conclusion) {
            let maxY = actualCenterY;
            for (const placed of placedElements) {
              maxY = Math.max(maxY, placed.y + placed.height);
            }

            const conclusionText = wrapText(preparedContent.conclusion, 350, 14);
            const conclusionWidth = 400;
            const conclusionHeight = Math.max(90, calculateTextHeight(conclusionText, 14) + 40);
            const conclusionPos = findValidPosition(actualCenterX - conclusionWidth/2, maxY + 60, conclusionWidth, conclusionHeight);
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: conclusionPos.x,
              y: conclusionPos.y,
              width: conclusionWidth,
              height: conclusionHeight,
              text: `Key Insight: ${conclusionText}`,
              fillColor: '#EDE9FE',
              strokeColor: '#8B5CF6',
              borderRadius: 16,
              fontSize: 14,
              opacity: 1
            });
          }
        },

        // ========== EVENT CIRCUIT LAYOUT - FULLY DYNAMIC ==========
        eventcircuit: () => {
          const sections = preparedContent.sections || [];
          if (sections.length === 0) return;

          // ═══════════════════════════════════════════════════════════════
          // DYNAMIC LAYOUT CONFIGURATION
          // ═══════════════════════════════════════════════════════════════
          const NODE_WIDTH = 220;
          const NODE_MIN_HEIGHT = 60;
          const DECISION_SIZE = 90;
          const CIRCLE_RADIUS = 50;
          const SIBLING_GAP_X = 25;
          const ROW_GAP_Y = 40;
          const SECTION_GAP_Y = 70;
          
          // Dynamic center based on content width
          const maxItemsPerRow = 6;
          const estimatedWidth = maxItemsPerRow * (NODE_WIDTH + SIBLING_GAP_X);
          const centerX = baseX + estimatedWidth / 2 + 200;
          let currentY = baseY + 50;

          // Generate colors dynamically for any section type
          const colorPalette = [
            { fill: '#DC2626', stroke: '#991B1B', light: '#FEE2E2', text: '#FFFFFF' },
            { fill: '#EA580C', stroke: '#C2410C', light: '#FFEDD5', text: '#FFFFFF' },
            { fill: '#D97706', stroke: '#B45309', light: '#FEF3C7', text: '#FFFFFF' },
            { fill: '#65A30D', stroke: '#4D7C0F', light: '#ECFCCB', text: '#FFFFFF' },
            { fill: '#059669', stroke: '#047857', light: '#D1FAE5', text: '#FFFFFF' },
            { fill: '#0D9488', stroke: '#0F766E', light: '#CCFBF1', text: '#FFFFFF' },
            { fill: '#0891B2', stroke: '#0E7490', light: '#CFFAFE', text: '#FFFFFF' },
            { fill: '#6366F1', stroke: '#4F46E5', light: '#E0E7FF', text: '#FFFFFF' },
            { fill: '#8B5CF6', stroke: '#7C3AED', light: '#EDE9FE', text: '#FFFFFF' },
            { fill: '#DB2777', stroke: '#BE185D', light: '#FCE7F3', text: '#FFFFFF' },
            { fill: '#F59E0B', stroke: '#D97706', light: '#FEF3C7', text: '#1F2937' },
            { fill: '#10B981', stroke: '#059669', light: '#D1FAE5', text: '#FFFFFF' },
            { fill: '#3B82F6', stroke: '#2563EB', light: '#DBEAFE', text: '#FFFFFF' },
            { fill: '#EF4444', stroke: '#DC2626', light: '#FEE2E2', text: '#FFFFFF' },
            { fill: '#1F2937', stroke: '#111827', light: '#F3F4F6', text: '#FFFFFF' },
            { fill: '#64748B', stroke: '#475569', light: '#F1F5F9', text: '#FFFFFF' },
            { fill: '#22C55E', stroke: '#16A34A', light: '#DCFCE7', text: '#FFFFFF' },
            { fill: '#7C3AED', stroke: '#6D28D9', light: '#EDE9FE', text: '#FFFFFF' },
          ];

          // Special type colors (override palette for known types)
          const typeColors = {
            root_decision: colorPalette[0],
            decision_nodes: colorPalette[10],
            terminal_outcomes: colorPalette[14],
            optimal_path: colorPalette[16],
            risk_cascade: colorPalette[9],
            opportunity_cascade: colorPalette[11],
            action_items: colorPalette[12],
            early_warning_indicators: colorPalette[13],
          };

          const getColor = (type, index) => typeColors[type] || colorPalette[index % colorPalette.length];

          // Track all nodes for dynamic connections
          const allNodes = new Map(); // sectionType -> nodes[]
          let previousSectionNodes = [];

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Create a sticky note node
          // ═══════════════════════════════════════════════════════════════
          const createNode = (x, y, text, color, badge = '') => {
            const nodeId = generateId();
            const wrappedText = wrapText(text, NODE_WIDTH - 20, 10);
            const textHeight = calculateTextHeight(wrappedText, 10);
            const nodeHeight = Math.max(NODE_MIN_HEIGHT, textHeight + (badge ? 40 : 25));
            const displayText = badge ? `${badge}\n${wrappedText}` : wrappedText;
            
            placeElement({
              id: nodeId,
              type: 'sticky',
              x, y,
              width: NODE_WIDTH,
              height: nodeHeight,
              text: displayText,
              fillColor: color.light,
              strokeColor: color.stroke,
              strokeWidth: 2,
              borderRadius: 8,
              fontSize: 10,
              opacity: 1
            });

            return {
              id: nodeId, x, y,
              width: NODE_WIDTH,
              height: nodeHeight,
              centerX: x + NODE_WIDTH / 2,
              centerY: y + nodeHeight / 2,
              bottomY: y + nodeHeight,
              topY: y
            };
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Create a decision diamond (with label below)
          // ═══════════════════════════════════════════════════════════════
          const createDiamond = (x, y, text, color) => {
            const nodeId = generateId();
            const size = DECISION_SIZE;
            
            placeElement({
              id: nodeId,
              type: 'diamond',
              x, y,
              width: size,
              height: size,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 3,
              opacity: 1
            });

            // Place label BELOW the diamond to avoid overflow
            const labelWidth = Math.max(size + 40, 140);
            const labelText = text.length > 60 ? text.substring(0, 57) + '...' : text;
            const wrappedLabel = wrapText(labelText, labelWidth - 10, 9);
            const labelHeight = calculateTextHeight(wrappedLabel, 9) + 8;
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: x + size / 2 - labelWidth / 2,
              y: y + size + 8,
              width: labelWidth,
              height: Math.max(30, labelHeight),
              text: wrappedLabel,
              fillColor: color.light,
              strokeColor: color.stroke,
              strokeWidth: 1,
              borderRadius: 6,
              fontSize: 9,
              textAlign: 'center',
              opacity: 1
            });

            const totalHeight = size + 8 + Math.max(30, labelHeight);
            return {
              id: nodeId, x, y,
              width: size,
              height: totalHeight,
              centerX: x + size / 2,
              centerY: y + size / 2,
              bottomY: y + totalHeight,
              topY: y
            };
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Create a circle node (for terminals/outcomes) with label below
          // ═══════════════════════════════════════════════════════════════
          const createCircle = (x, y, text, color, index = 0) => {
            const nodeId = generateId();
            const r = CIRCLE_RADIUS + 15; // Larger radius for text
            
            placeElement({
              id: nodeId,
              type: 'ellipse',
              x, y,
              width: r * 2,
              height: r * 2,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 3,
              opacity: 1
            });

            // Extract first few words for inside the circle (max 25 chars)
            const words = text.split(' ');
            let innerText = '';
            for (const word of words) {
              if ((innerText + ' ' + word).trim().length <= 22) {
                innerText = (innerText + ' ' + word).trim();
              } else break;
            }
            if (innerText.length === 0) innerText = text.substring(0, 20);
            if (innerText.length < text.length) innerText += '...';
            
            // Wrap text to fit inside circle
            const innerWrapped = wrapText(innerText, r * 2 - 20, 10);
            const innerHeight = calculateTextHeight(innerWrapped, 10);
            
            placeElement({
              id: generateId(),
              type: 'text',
              x: x + 10,
              y: y + r - innerHeight / 2,
              text: innerWrapped,
              fontSize: 10,
              fontWeight: 'bold',
              fillColor: color.text,
              width: r * 2 - 20,
              height: innerHeight + 4,
              textAlign: 'center',
              opacity: 1
            });

            // Full label BELOW the circle as a sticky note (only if text is longer)
            let totalHeight = r * 2;
            if (text.length > 25) {
              const labelWidth = Math.max(r * 2 + 20, 180);
              const wrappedLabel = wrapText(text, labelWidth - 16, 9);
              const labelHeight = calculateTextHeight(wrappedLabel, 9) + 12;
              
              placeElement({
                id: generateId(),
                type: 'sticky',
                x: x + r - labelWidth / 2,
                y: y + r * 2 + 8,
                width: labelWidth,
                height: Math.max(40, labelHeight),
                text: wrappedLabel,
                fillColor: color.light,
                strokeColor: color.stroke,
                strokeWidth: 1,
                borderRadius: 6,
                fontSize: 9,
                textAlign: 'center',
                opacity: 1
              });
              totalHeight = r * 2 + 8 + Math.max(40, labelHeight);
            }

            return {
              id: nodeId, x, y,
              width: r * 2,
              height: totalHeight,
              centerX: x + r,
              centerY: y + r,
              bottomY: y + totalHeight,
              topY: y
            };
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Create hexagon (for root/central nodes) with label below
          // ═══════════════════════════════════════════════════════════════
          const createHexagon = (x, y, text, color, size = 140) => {
            const nodeId = generateId();
            
            placeElement({
              id: nodeId,
              type: 'hexagon',
              x, y,
              width: size,
              height: size,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 4,
              opacity: 1
            });

            // Short title inside hexagon (truncated)
            const innerText = text.length > 20 ? text.substring(0, 17) + '...' : text;
            placeElement({
              id: generateId(),
              type: 'text',
              x: x + 20,
              y: y + size / 2 - 12,
              text: innerText,
              fontSize: 12,
              fontWeight: 'bold',
              fillColor: color.text,
              width: size - 40,
              height: 24,
              textAlign: 'center',
              opacity: 1
            });

            // Full text label BELOW hexagon if text is longer
            let totalHeight = size;
            if (text.length > 20) {
              const labelWidth = Math.max(size + 40, 200);
              const wrappedLabel = wrapText(text, labelWidth - 16, 10);
              const labelHeight = calculateTextHeight(wrappedLabel, 10) + 12;
              
              placeElement({
                id: generateId(),
                type: 'sticky',
                x: x + size / 2 - labelWidth / 2,
                y: y + size + 10,
                width: labelWidth,
                height: Math.max(35, labelHeight),
                text: wrappedLabel,
                fillColor: color.light,
                strokeColor: color.stroke,
                strokeWidth: 1,
                borderRadius: 8,
                fontSize: 10,
                textAlign: 'center',
                opacity: 1
              });
              totalHeight = size + 10 + Math.max(35, labelHeight);
            }

            return {
              id: nodeId, x, y,
              width: size,
              height: totalHeight,
              centerX: x + size / 2,
              centerY: y + size / 2,
              bottomY: y + totalHeight,
              topY: y
            };
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Connect two nodes with bezier curve
          // ═══════════════════════════════════════════════════════════════
          const connectNodes = (fromNode, toNode, color) => {
            if (!fromNode || !toNode) return;
            
            connectorElements.push({
              id: generateId(),
              type: 'connector',
              startElementId: fromNode.id,
              endElementId: toNode.id,
              startPoint: { x: fromNode.centerX, y: fromNode.bottomY, edge: 'bottom' },
              endPoint: { x: toNode.centerX, y: toNode.topY, edge: 'top' },
              points: [
                { x: fromNode.centerX, y: fromNode.bottomY },
                { x: fromNode.centerX, y: fromNode.bottomY + 15 },
                { x: toNode.centerX, y: toNode.topY - 15 },
                { x: toNode.centerX, y: toNode.topY }
              ],
              strokeColor: color,
              strokeWidth: 2,
              connectorStyle: 'bezier',
              curvature: 0.5,
              arrowEnd: true,
              opacity: 0.8
            });
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Connect horizontally
          // ═══════════════════════════════════════════════════════════════
          const connectHorizontal = (fromNode, toNode, color) => {
            if (!fromNode || !toNode) return;
            connectorElements.push({
              id: generateId(),
              type: 'connector',
              startElementId: fromNode.id,
              endElementId: toNode.id,
              startPoint: { x: fromNode.x + fromNode.width, y: fromNode.centerY, edge: 'right' },
              endPoint: { x: toNode.x, y: toNode.centerY, edge: 'left' },
              points: [
                { x: fromNode.x + fromNode.width, y: fromNode.centerY },
                { x: toNode.x, y: toNode.centerY }
              ],
              strokeColor: color,
              strokeWidth: 2,
              connectorStyle: 'bezier',
              curvature: 0.3,
              arrowEnd: true,
              opacity: 0.8
            });
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Place section header
          // ═══════════════════════════════════════════════════════════════
          const placeSectionHeader = (title, color) => {
            const headerWidth = Math.min(500, title.length * 10 + 60);
            placeElement({
              id: generateId(),
              type: 'rect',
              x: centerX - headerWidth / 2,
              y: currentY,
              width: headerWidth,
              height: 32,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 2,
              borderRadius: 16,
              opacity: 1
            });
            placeElement({
              id: generateId(),
              type: 'text',
              x: centerX - headerWidth / 2 + 10,
              y: currentY + 7,
              text: title,
              fontSize: 12,
              fontWeight: 'bold',
              fillColor: color.text,
              width: headerWidth - 20,
              height: 20,
              textAlign: 'center',
              opacity: 1
            });
            currentY += 45;
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Place ALL items from a section dynamically
          // ═══════════════════════════════════════════════════════════════
          const placeAllItems = (items, color, nodeType = 'sticky', badge = '', maxPerRow = 5) => {
            const nodes = [];
            if (!items || items.length === 0) return { nodes, endY: currentY };

            const itemCount = items.length;
            const rows = Math.ceil(itemCount / maxPerRow);

            for (let r = 0; r < rows; r++) {
              const rowItems = items.slice(r * maxPerRow, (r + 1) * maxPerRow);
              // Account for larger circle/diamond with labels below
              const itemWidth = nodeType === 'diamond' ? DECISION_SIZE + 50 : 
                               nodeType === 'circle' ? (CIRCLE_RADIUS + 10) * 2 + 40 : NODE_WIDTH;
              const gap = nodeType === 'diamond' || nodeType === 'circle' ? 60 : SIBLING_GAP_X;
              const rowWidth = rowItems.length * (itemWidth + gap) - gap;
              let itemX = centerX - rowWidth / 2;

              let maxNodeHeight = 0;
              rowItems.forEach((item, idx) => {
                const globalIdx = r * maxPerRow + idx;
                const itemBadge = badge ? `${badge}${globalIdx + 1}` : '';
                
                let node;
                if (nodeType === 'diamond') {
                  node = createDiamond(itemX, currentY, item, color);
                } else if (nodeType === 'circle') {
                  node = createCircle(itemX, currentY, item, color);
                } else {
                  node = createNode(itemX, currentY, item, color, itemBadge);
                }
                nodes.push(node);
                maxNodeHeight = Math.max(maxNodeHeight, node.height);

                // Connect to appropriate parent from previous section
                if (previousSectionNodes.length > 0) {
                  const parentIdx = Math.floor(globalIdx * previousSectionNodes.length / itemCount);
                  const parent = previousSectionNodes[Math.min(parentIdx, previousSectionNodes.length - 1)];
                  connectNodes(parent, node, color.stroke);
                }

                itemX += itemWidth + gap;
              });

              // Use actual max height from this row for proper spacing
              currentY += maxNodeHeight + ROW_GAP_Y;
            }

            return { nodes, endY: currentY };
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Place items in horizontal flow (for optimal path, etc.)
          // ═══════════════════════════════════════════════════════════════
          const placeHorizontalFlow = (items, color, badge = 'Step ') => {
            const nodes = [];
            if (!items || items.length === 0) return { nodes, endY: currentY };

            const nodeWidth = 180;
            const gap = 30;
            const totalWidth = items.length * nodeWidth + (items.length - 1) * gap;
            let itemX = centerX - totalWidth / 2;
            let prevNode = null;
            let maxHeight = NODE_MIN_HEIGHT;

            items.forEach((item, idx) => {
              const nodeId = generateId();
              const text = wrapText(item, nodeWidth - 16, 9);
              const h = Math.max(55, calculateTextHeight(text, 9) + 30);
              maxHeight = Math.max(maxHeight, h);
              
              placeElement({
                id: nodeId,
                type: 'sticky',
                x: itemX,
                y: currentY,
                width: nodeWidth,
                height: h,
                text: `${badge}${idx + 1}\n${text}`,
                fillColor: color.light,
                strokeColor: color.stroke,
                strokeWidth: 2,
                borderRadius: 8,
                fontSize: 9,
                opacity: 1
              });

              const node = {
                id: nodeId,
                x: itemX,
                y: currentY,
                width: nodeWidth,
                height: h,
                centerX: itemX + nodeWidth / 2,
                centerY: currentY + h / 2,
                bottomY: currentY + h,
                topY: currentY
              };
              nodes.push(node);

              if (prevNode) {
                connectHorizontal(prevNode, node, color.stroke);
              }

              prevNode = node;
              itemX += nodeWidth + gap;
            });

            currentY += maxHeight + ROW_GAP_Y;
            return { nodes, endY: currentY };
          };

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Place side-by-side columns (risk vs opportunity)
          // ═══════════════════════════════════════════════════════════════
          const placeSideBySide = (leftItems, rightItems, leftColor, rightColor, leftTitle, rightTitle) => {
            const colWidth = 450;
            const gap = 60;
            const leftX = centerX - gap / 2 - colWidth + 100;
            const rightX = centerX + gap / 2 + 100;
            const startY = currentY;
            let leftY = startY;
            let rightY = startY;

            // Left column header
            if (leftItems?.length > 0) {
              placeElement({
                id: generateId(),
                type: 'rect',
                x: leftX + colWidth / 2 - 100,
                y: leftY,
                width: 200,
                height: 28,
                fillColor: leftColor.fill,
                strokeColor: leftColor.stroke,
                strokeWidth: 2,
                borderRadius: 14,
                opacity: 1
              });
              placeElement({
                id: generateId(),
                type: 'text',
                x: leftX + colWidth / 2 - 90,
                y: leftY + 5,
                text: leftTitle,
                fontSize: 11,
                fontWeight: 'bold',
                fillColor: leftColor.text,
                width: 180,
                height: 18,
                textAlign: 'center',
                opacity: 1
              });
              leftY += 38;

              let prevNode = null;
              leftItems.forEach((item, idx) => {
                const node = createNode(leftX + 20, leftY, item, leftColor, `${idx + 1}.`);
                if (prevNode) connectNodes(prevNode, node, leftColor.stroke);
                prevNode = node;
                leftY += node.height + 20;
              });
            }

            // Right column header
            if (rightItems?.length > 0) {
              placeElement({
                id: generateId(),
                type: 'rect',
                x: rightX + colWidth / 2 - 100,
                y: rightY,
                width: 200,
                height: 28,
                fillColor: rightColor.fill,
                strokeColor: rightColor.stroke,
                strokeWidth: 2,
                borderRadius: 14,
                opacity: 1
              });
              placeElement({
                id: generateId(),
                type: 'text',
                x: rightX + colWidth / 2 - 90,
                y: rightY + 5,
                text: rightTitle,
                fontSize: 11,
                fontWeight: 'bold',
                fillColor: rightColor.text,
                width: 180,
                height: 18,
                textAlign: 'center',
                opacity: 1
              });
              rightY += 38;

              let prevNode = null;
              rightItems.forEach((item, idx) => {
                const node = createNode(rightX + 20, rightY, item, rightColor, `${idx + 1}.`);
                if (prevNode) connectNodes(prevNode, node, rightColor.stroke);
                prevNode = node;
                rightY += node.height + 20;
              });
            }

            // Divider
            const maxY = Math.max(leftY, rightY);
            if (leftItems?.length > 0 && rightItems?.length > 0) {
              placeElement({
                id: generateId(),
                type: 'rect',
                x: centerX - 2,
                y: startY,
                width: 4,
                height: maxY - startY,
                fillColor: '#D1D5DB',
                strokeColor: '#D1D5DB',
                strokeWidth: 0,
                borderRadius: 2,
                opacity: 0.5
              });
            }

            currentY = maxY + SECTION_GAP_Y;
          };

          // ═══════════════════════════════════════════════════════════════
          // 1. TITLE & DESCRIPTION
          // ═══════════════════════════════════════════════════════════════
          placeElement({
            id: generateId(),
            type: 'text',
            x: centerX - 450,
            y: currentY,
            text: preparedContent.title || 'Event Circuit Analysis',
            fontSize: 26,
            fontWeight: 'bold',
            fillColor: '#1F2937',
            width: 900,
            height: 36,
            textAlign: 'center',
            opacity: 1
          });
          currentY += 45;

          if (preparedContent.description) {
            placeElement({
              id: generateId(),
              type: 'text',
              x: centerX - 400,
              y: currentY,
              text: wrapText(preparedContent.description, 750, 11),
              fontSize: 11,
              fillColor: '#6B7280',
              width: 800,
              height: 35,
              textAlign: 'center',
              opacity: 0.9
            });
            currentY += 45;
          }

          // ═══════════════════════════════════════════════════════════════
          // 2. DYNAMICALLY PROCESS ALL SECTIONS
          // ═══════════════════════════════════════════════════════════════
          
          // Section type configurations for visual representation
          const sectionTypeConfig = {
            root_decision: { nodeType: 'hexagon', isRoot: true },
            decision_nodes: { nodeType: 'diamond', maxPerRow: 4 },
            terminal_outcomes: { nodeType: 'circle', maxPerRow: 5 },
            optimal_path: { layout: 'horizontal' },
            risk_cascade: { layout: 'column', side: 'left' },
            opportunity_cascade: { layout: 'column', side: 'right' },
          };

          // Find paired sections for side-by-side layout
          const riskSection = sections.find(s => s.type === 'risk_cascade');
          const oppSection = sections.find(s => s.type === 'opportunity_cascade');
          const pairedSections = new Set();
          if (riskSection) pairedSections.add('risk_cascade');
          if (oppSection) pairedSections.add('opportunity_cascade');

          // Process each section in order
          sections.forEach((section, sectionIdx) => {
            if (!section.items || section.items.length === 0) return;
            if (pairedSections.has(section.type) && section.type === 'opportunity_cascade') return; // handled with risk

            const color = getColor(section.type, sectionIdx);
            const config = sectionTypeConfig[section.type] || {};
            const title = section.title || section.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const items = section.items; // No limit - plot ALL items

            // Handle root/central node specially
            if (config.isRoot) {
              const rootSize = 140;
              const rootNode = createHexagon(centerX - rootSize / 2, currentY, title, color, rootSize);
              currentY += rootSize + 30;
              previousSectionNodes = [rootNode];
              allNodes.set(section.type, [rootNode]);

              // Place root items below
              if (items.length > 0) {
                placeSectionHeader(`📋 ${title} Details`, color);
                const result = placeAllItems(items, color, 'sticky', '', 5);
                previousSectionNodes = result.nodes;
                allNodes.set(section.type + '_items', result.nodes);
                currentY = result.endY + SECTION_GAP_Y;
              }
              return;
            }

            // Handle paired side-by-side sections
            if (section.type === 'risk_cascade' && (riskSection || oppSection)) {
              const rColor = getColor('risk_cascade', sectionIdx);
              const oColor = getColor('opportunity_cascade', sectionIdx + 1);
              placeSideBySide(
                riskSection?.items || [],
                oppSection?.items || [],
                rColor, oColor,
                '⚠️ Risk Cascade',
                '✅ Opportunity Cascade'
              );
              return;
            }

            // Handle horizontal flow layout
            if (config.layout === 'horizontal') {
              placeSectionHeader(`🌟 ${title}`, color);
              const result = placeHorizontalFlow(items, color, 'Step ');
              previousSectionNodes = result.nodes;
              allNodes.set(section.type, result.nodes);
              currentY = result.endY + SECTION_GAP_Y;
              return;
            }

            // Standard section with header and items
            placeSectionHeader(getIcon(section.type) + ' ' + title, color);
            
            const nodeType = config.nodeType || 'sticky';
            const maxPerRow = config.maxPerRow || 5;
            const badge = getBadge(section.type);
            
            const result = placeAllItems(items, color, nodeType, badge, maxPerRow);
            previousSectionNodes = result.nodes;
            allNodes.set(section.type, result.nodes);
            currentY = result.endY + SECTION_GAP_Y;
          });

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Get icon for section type
          // ═══════════════════════════════════════════════════════════════
          function getIcon(type) {
            const icons = {
              root_decision: '🎯',
              context_constraints: '📋',
              possible_actions: '🎯',
              immediate_outcomes_t0: '⚡',
              chain_reactions_t1: '🔗',
              chain_reactions_t2: '🌊',
              chain_reactions_t3: '📈',
              chain_reactions_t4_plus: '🎯',
              decision_nodes: '⚖️',
              probability_matrix: '📊',
              risk_cascade: '⚠️',
              opportunity_cascade: '✅',
              convergence_points: '🔀',
              terminal_outcomes: '🏁',
              optimal_path: '🌟',
              alternative_paths: '↪️',
              early_warning_indicators: '🚨',
              action_items: '✅',
            };
            return icons[type] || '📌';
          }

          // ═══════════════════════════════════════════════════════════════
          // HELPER: Get badge prefix for section type
          // ═══════════════════════════════════════════════════════════════
          function getBadge(type) {
            const badges = {
              possible_actions: 'Option ',
              chain_reactions_t1: 'Effect ',
              chain_reactions_t2: 'Effect ',
              chain_reactions_t3: 'Effect ',
              chain_reactions_t4_plus: 'Effect ',
              action_items: '→ ',
              alternative_paths: 'Plan ',
              early_warning_indicators: '⚠️ ',
            };
            return badges[type] || '';
          }

          // ═══════════════════════════════════════════════════════════════
          // CONCLUSION
          // ═══════════════════════════════════════════════════════════════
          if (preparedContent.conclusion) {
            const conclText = wrapText(preparedContent.conclusion, 700, 12);
            const conclH = Math.max(80, calculateTextHeight(conclText, 12) + 40);
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: centerX - 380,
              y: currentY,
              width: 760,
              height: conclH,
              text: `🎯 KEY INSIGHT\n\n${conclText}`,
              fillColor: '#FEF3C7',
              strokeColor: '#F59E0B',
              strokeWidth: 3,
              borderRadius: 14,
              fontSize: 12,
              opacity: 1
            });
          }
        }
      };

      // ═══════════════════════════════════════════════════════════════
      // EXECUTE LAYOUT GENERATOR WITH ERROR HANDLING
      // ═══════════════════════════════════════════════════════════════
      try {
        // Execute the appropriate layout generator
        const generator = layoutGenerators[templateType] || layoutGenerators.mindmap;
        generator();
      } catch (layoutError) {
        console.error('[MIRA] Layout generation failed:', layoutError);
        
        // Attempt fallback to mindmap layout
        try {
          console.log('[MIRA] Attempting fallback to mindmap layout...');
          layoutGenerators.mindmap();
          console.log('[MIRA] Fallback to mindmap layout succeeded');
        } catch (fallbackError) {
          console.error('[MIRA] Fallback layout also failed:', fallbackError);
          return NextResponse.json({
            error: 'Failed to generate canvas layout. Please try a different template or simplify your content.',
            details: layoutError?.message || 'Layout generation error'
          }, { status: 500 });
        }
      }

      // Combine content elements and connectors (connectors last)
      const generatedObjects = [...contentElements, ...connectorElements];
      
      // Validate that we have objects
      if (generatedObjects.length === 0) {
        console.error('[MIRA] No objects generated');
        return NextResponse.json({
          error: 'No content elements were generated. Please ensure your content has sections with items.',
          details: 'Empty output'
        }, { status: 400 });
      }

      // Generate a unique ID for this generation
      const generationId = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      // Tag all elements with this generation ID for tracking
      generatedObjects.forEach(obj => {
        obj.generationId = generationId;
      });

      // Add to target page - use filtered objects (previous MIRA elements removed) + new generated objects
      const currentPage = whiteboard.pages[pageIndex] || { objects: [] };
      currentPage.objects = [...filteredObjects, ...generatedObjects];
      whiteboard.pages[pageIndex] = currentPage;
      
      console.log(`[MIRA] Page ${pageIndex} updated: ${filteredObjects.length} existing + ${generatedObjects.length} new = ${currentPage.objects.length} total elements`);

      // Create generation record for history
      const generationRecord = {
        id: generationId,
        templateType,
        title: preparedContent.title || 'Untitled',
        description: preparedContent.description || '',
        sections: preparedContent.sections || [],
        conclusion: preparedContent.conclusion || '',
        userPrompt: preparedContent.userPrompt || body.userPrompt || '',
        isPlotted: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Initialize agentContent if not exists
      if (!whiteboard.aiAnalysis.agentContent) {
        whiteboard.aiAnalysis.agentContent = {
          currentGenerationId: null,
          generations: []
        };
      }

      // Add to generations history
      whiteboard.aiAnalysis.agentContent.generations.push(generationRecord);
      whiteboard.aiAnalysis.agentContent.currentGenerationId = generationId;

      // Also update legacy field for backward compatibility
      if (whiteboard.aiAnalysis.agentPreparedContent) {
        whiteboard.aiAnalysis.agentPreparedContent.isPlotted = true;
        whiteboard.aiAnalysis.agentPreparedContent.updatedAt = new Date();
      }
      whiteboard.aiAnalysis.contentElementMapping = sectionMapping;
      whiteboard.aiAnalysis.messages.push(
        { role: 'user', content: 'Plot prepared content on canvas', timestamp: new Date() },
        { role: 'assistant', content: `Created ${generatedObjects.length} elements from your prepared content as a ${templateType}. The content is now visualized on the canvas!`, timestamp: new Date() }
      );

      // Mark as modified to ensure Mongoose detects changes in nested objects
      whiteboard.markModified('aiAnalysis');
      whiteboard.markModified('pages');

      // Save using chunked approach - save objects in batches to handle large documents
      const MAX_SAVE_RETRIES = 5;
      const CHUNK_SIZE = 50; // Save 50 objects at a time
      let saveSuccess = false;
      let saveError = null;
      
      const allObjects = currentPage.objects;
      const totalObjects = allObjects.length;
      
      console.log(`[MIRA] Preparing to save ${totalObjects} objects in chunks of ${CHUNK_SIZE}`);
      
      for (let attempt = 0; attempt < MAX_SAVE_RETRIES && !saveSuccess; attempt++) {
        try {
          // Clear the page objects first
          console.log(`[MIRA] Attempt ${attempt + 1}: Clearing page ${pageIndex}...`);
          await Whiteboard.updateOne(
            { _id: whiteboard._id },
            { $set: { [`pages.${pageIndex}.objects`]: [] } },
            { maxTimeMS: 30000 }
          );
          
          // Save objects in chunks using $push with $each
          for (let i = 0; i < totalObjects; i += CHUNK_SIZE) {
            const chunk = allObjects.slice(i, i + CHUNK_SIZE);
            const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
            const totalChunks = Math.ceil(totalObjects / CHUNK_SIZE);
            
            console.log(`[MIRA] Attempt ${attempt + 1}: Saving chunk ${chunkNum}/${totalChunks} (${chunk.length} objects)...`);
            
            await Whiteboard.updateOne(
              { _id: whiteboard._id },
              { 
                $push: { 
                  [`pages.${pageIndex}.objects`]: { $each: chunk } 
                }
              },
              { maxTimeMS: 60000 }
            );
          }
          
          // Save aiAnalysis separately (smaller payload)
          console.log(`[MIRA] Attempt ${attempt + 1}: Saving aiAnalysis...`);
          await Whiteboard.updateOne(
            { _id: whiteboard._id },
            {
              $set: {
                aiAnalysis: whiteboard.aiAnalysis,
                lastModified: new Date()
              }
            },
            { maxTimeMS: 30000 }
          );
          
          saveSuccess = true;
          console.log(`[MIRA] Whiteboard saved successfully (attempt ${attempt + 1}) - ${totalObjects} objects in ${Math.ceil(totalObjects / CHUNK_SIZE)} chunks`);
        } catch (err) {
          saveError = err;
          console.error(`[MIRA] Save attempt ${attempt + 1} failed:`, err.message, err.code);
          if (attempt < MAX_SAVE_RETRIES - 1) {
            // Exponential backoff with longer delays
            const delay = 3000 * Math.pow(2, attempt);
            console.log(`[MIRA] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!saveSuccess) {
        console.error('[MIRA] All save attempts failed:', saveError?.message);
        return NextResponse.json({
          error: 'Failed to save canvas after multiple attempts. Your content was generated but could not be saved. Please try again.',
          details: saveError?.message || 'Save error'
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        generatedObjects,
        objectCount: generatedObjects.length,
        pages: whiteboard.pages,
        sectionMapping,
        aiAnalysis: whiteboard.aiAnalysis,
        generationId
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('AI Analysis error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to analyze canvas'
    }, { status: 500 });
  }
}

// GET - Retrieve saved AI analysis
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard } = models

    const { id } = await params;
    const whiteboard = await Whiteboard.findById(id);

    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    const permission = whiteboard.getUserPermission(user._id || user.userId);
    if (!permission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      aiAnalysis: whiteboard.aiAnalysis || { summary: '', messages: [], notes: [], keyPoints: [] }
    });

  } catch (error) {
    console.error('Get AI Analysis error:', error);
    return NextResponse.json({ error: 'Failed to get analysis' }, { status: 500 });
  }
}
