import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { generateContent, generateVisionContent } from '@/lib/gemini';
import { generateSmartContent } from '@/lib/promptEngine';

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
      
      // Enhanced template-specific structure definitions with deep research focus
      const templateStructures = {
        mindmap: {
          description: 'comprehensive radial thought map with central topic and extensively branching ideas',
          minSections: 6,
          maxSections: 8,
          itemsPerSection: '5-8',
          sections: [
            { type: 'central', title: 'Core Concept & Definition', purpose: 'The fundamental definition, scope, and significance of the topic' },
            { type: 'branch', title: 'Key Dimensions & Components', purpose: '6-8 primary aspects, pillars, or dimensions of the topic' },
            { type: 'context', title: 'Market/Industry Context', purpose: 'Current landscape, trends, statistics, and relevant data points' },
            { type: 'stakeholders', title: 'Stakeholders & Audience', purpose: 'Who is affected, target demographics, user personas, decision makers' },
            { type: 'strategies', title: 'Strategies & Approaches', purpose: 'Methodologies, frameworks, best practices, proven techniques' },
            { type: 'challenges', title: 'Challenges & Solutions', purpose: 'Common obstacles, risks, mitigation strategies, and workarounds' },
            { type: 'metrics', title: 'Success Metrics & KPIs', purpose: 'How to measure success, benchmarks, industry standards' },
            { type: 'action', title: 'Implementation Roadmap', purpose: 'Concrete next steps, priorities, quick wins, long-term initiatives' },
          ]
        },
        flowchart: {
          description: 'detailed process flow with comprehensive steps, decision logic, and exception handling',
          minSections: 5,
          maxSections: 7,
          itemsPerSection: '4-7',
          sections: [
            { type: 'prerequisites', title: 'Prerequisites & Inputs', purpose: 'Required resources, data, approvals, or conditions needed before starting' },
            { type: 'start', title: 'Initiation Phase', purpose: 'Entry points, triggers, and initial setup steps' },
            { type: 'core_process', title: 'Core Process Steps', purpose: 'Detailed sequential actions with specific instructions' },
            { type: 'decisions', title: 'Decision Points & Logic', purpose: 'Conditional branches, criteria for each path, edge cases' },
            { type: 'parallel', title: 'Parallel Workflows', purpose: 'Concurrent activities, dependencies, synchronization points' },
            { type: 'exceptions', title: 'Exception Handling', purpose: 'Error scenarios, fallback procedures, escalation paths' },
            { type: 'outputs', title: 'Outputs & Deliverables', purpose: 'Expected results, quality criteria, handoff points' },
          ]
        },
        planning: {
          description: 'comprehensive project plan with strategic objectives, detailed tasks, and resource allocation',
          minSections: 6,
          maxSections: 8,
          itemsPerSection: '5-8',
          sections: [
            { type: 'vision', title: 'Vision & Objectives', purpose: 'Strategic goals, success criteria, alignment with broader initiatives' },
            { type: 'scope', title: 'Scope Definition', purpose: 'In-scope items, out-of-scope items, boundaries and constraints' },
            { type: 'phases', title: 'Project Phases', purpose: 'Major phases with durations, phase gates, and deliverables' },
            { type: 'tasks', title: 'Detailed Task Breakdown', purpose: 'Specific work items, owners, effort estimates, priorities' },
            { type: 'resources', title: 'Resources & Budget', purpose: 'Team allocation, tools needed, budget considerations' },
            { type: 'risks', title: 'Risks & Mitigation', purpose: 'Identified risks, probability, impact, mitigation strategies' },
            { type: 'milestones', title: 'Milestones & Deadlines', purpose: 'Key dates, dependencies, critical path items' },
            { type: 'governance', title: 'Governance & Review', purpose: 'Review cadence, stakeholder updates, decision authority' },
          ]
        },
        eventcircuit: {
          description: 'comprehensive decision chain reaction analysis with consequence mapping, probability assessment, and optimal path calculation',
          minSections: 8,
          maxSections: 10,
          itemsPerSection: '4-6',
          sections: [
            { type: 'decision_point', title: 'Decision/Goal Definition', purpose: 'The core decision to analyze or goal to achieve, with full context and constraints' },
            { type: 'immediate_outcomes', title: 'Immediate Outcomes (T+0)', purpose: 'Direct first-order effects that happen immediately upon decision/action' },
            { type: 'chain_level_1', title: 'First Chain Reactions (T+1)', purpose: 'Second-order effects triggered by immediate outcomes, branching possibilities' },
            { type: 'chain_level_2', title: 'Deep Chain Reactions (T+2+)', purpose: 'Third and fourth-order cascading effects, long-term consequences' },
            { type: 'probability_paths', title: 'Probability Assessment', purpose: 'Likelihood percentages for each branch, confidence levels, key assumptions' },
            { type: 'risk_pathways', title: 'Risk Pathways & Failure Modes', purpose: 'Worst-case scenarios, failure chains, negative spirals to avoid' },
            { type: 'opportunity_branches', title: 'Opportunity Branches', purpose: 'Best-case scenarios, success amplifiers, positive feedback loops' },
            { type: 'critical_dependencies', title: 'Critical Dependencies', purpose: 'Key factors that determine which path actualizes, decision points, triggers' },
            { type: 'optimal_path', title: 'Optimal Path Analysis', purpose: 'Recommended route with highest success probability and best risk/reward ratio' },
            { type: 'contingency_routes', title: 'Alternative Routes & Pivots', purpose: 'Backup paths, pivot points, course corrections if primary path fails' },
          ]
        },
        ideas: {
          description: 'extensive creative brainstorm with categorized concepts, feasibility analysis, and prioritization',
          minSections: 6,
          maxSections: 8,
          itemsPerSection: '5-8',
          sections: [
            { type: 'theme', title: 'Central Theme & Context', purpose: 'Core problem statement, opportunity space, constraints' },
            { type: 'research', title: 'Research & Insights', purpose: 'Data points, user insights, market research, competitor analysis' },
            { type: 'categories', title: 'Idea Categories', purpose: 'Grouped concepts by theme, approach, or target segment' },
            { type: 'innovative', title: 'Innovative Concepts', purpose: 'Bold, disruptive, or unconventional ideas worth exploring' },
            { type: 'practical', title: 'Practical Solutions', purpose: 'Immediately actionable, low-risk, quick-win ideas' },
            { type: 'evaluation', title: 'Feasibility Analysis', purpose: 'Pros/cons, resource requirements, implementation complexity' },
            { type: 'priorities', title: 'Prioritized Recommendations', purpose: 'Top picks with rationale, suggested sequencing' },
            { type: 'next_steps', title: 'Exploration Paths', purpose: 'Questions to answer, experiments to run, validation needed' },
          ]
        }
      };

      const structure = templateStructures[templateType] || templateStructures.mindmap;

      // Template-specific deep research instructions
      const templateSpecificInstructions = {
        eventcircuit: `
=== EVENT CIRCUIT ANALYSIS - SPECIAL INSTRUCTIONS ===
This is a CHAIN REACTION CALCULATOR for decisions and goals. You MUST think like a systems theorist, decision scientist, and risk analyst combined.

CRITICAL ANALYSIS REQUIREMENTS:
1. CAUSALITY MAPPING: For every outcome, ask "AND THEN WHAT?" at least 3 levels deep
2. BRANCHING LOGIC: Every decision can lead to 2-4 distinct pathways - map ALL of them
3. PROBABILITY WEIGHTING: Assign realistic probability estimates (%) to each branch
4. TEMPORAL PROGRESSION: Clearly show T+0 (immediate), T+1 (short-term), T+2+ (long-term) effects
5. FEEDBACK LOOPS: Identify where outcomes can reinforce or dampen other effects
6. CRITICAL NODES: Mark decision points where small changes create large divergence

FOR GOALS: Calculate the optimal sequence of actions with highest success probability
FOR DECISIONS: Map all possible futures with their likelihood and impact

CHAIN REACTION DEPTH:
- Level 0: The decision/action itself
- Level 1: Immediate direct consequences (happens within hours/days)
- Level 2: Secondary effects triggered by Level 1 (happens within weeks)
- Level 3+: Cascade effects, compound consequences (months to years)

RISK PATHWAY ANALYSIS:
- Identify failure modes at each level
- Show how small risks can cascade into major problems
- Provide early warning indicators

OPPORTUNITY PATHWAY ANALYSIS:
- Identify success amplifiers
- Show how positive outcomes can compound
- Highlight timing-sensitive opportunities

OPTIMAL PATH CALCULATION:
- Consider probability × impact for each path
- Account for reversibility of decisions
- Identify the minimum viable path to success
`,
        mindmap: `
=== MINDMAP DEEP DIVE INSTRUCTIONS ===
Create a comprehensive knowledge map that serves as a single source of truth for this topic.
- Central concept should capture the ESSENCE in 3-5 words
- Each branch should represent a DISTINCT dimension (not overlapping)
- Sub-branches should drill down to SPECIFIC, actionable insights
- Include real data, benchmarks, and industry standards where applicable
`,
        flowchart: `
=== FLOWCHART PROCESS ANALYSIS INSTRUCTIONS ===
Map the process with PRECISION - every step matters.
- Include ALL decision points, not just the happy path
- Show exception handling and error recovery
- Add time estimates where relevant
- Identify bottlenecks and optimization opportunities
- Include parallel processes that can run simultaneously
`,
        planning: `
=== PROJECT PLANNING INSTRUCTIONS ===
Create a BATTLE-READY project plan.
- Every task should be specific enough to be assigned
- Include dependencies and blockers
- Estimate effort realistically (include buffer)
- Identify critical path items
- Plan for risks before they happen
`,
        ideas: `
=== BRAINSTORMING DEEP DIVE INSTRUCTIONS ===
Generate ideas that span the FULL spectrum from safe to revolutionary.
- Include at least 2 "crazy" ideas that challenge assumptions
- Ground innovative ideas in feasibility assessment
- Cross-pollinate ideas from adjacent industries
- Include quick wins AND long-term moonshots
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

For EACH section, provide:
- A clear, specific title (not generic)
- ${structure.itemsPerSection} detailed, actionable items (each should be a complete thought, 10-20 words)
- A concise summary capturing the key insight

=== CRITICAL GUIDELINES ===
- NO generic filler content - every item must be specific to this topic
- NO emojis anywhere
- Each item should stand alone as valuable insight
- Use specific numbers, percentages, or benchmarks where applicable
- Include contrarian or non-obvious perspectives
- Make connections between sections explicit
- The conclusion should synthesize key insights into strategic recommendations

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
        "Detailed, specific, actionable item with concrete guidance (10-20 words each)",
        "Another specific item that provides real value",
        "Continue with ${structure.itemsPerSection} items per section"
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
    "itemCount": total_number_of_items,
    "estimatedElements": approximate_canvas_elements_needed,
    "researchDepth": "comprehensive"
  }
}`;

      try {
        const aiResponse = await generateSmartContent(preparePrompt, {
          userId: user._id || user.userId,
          feature: 'whiteboard-prepare',
          skipRefinement: true
        });

        // Parse the response
        let jsonStr = aiResponse.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        let preparedContent;
        try {
          preparedContent = JSON.parse(jsonStr);
        } catch (e) {
          // Try to fix common JSON issues
          let fixedJson = jsonStr
            .replace(/,\s*}/g, '}')
            .replace(/,\s*\]/g, ']')
            .replace(/[\r\n]+/g, ' ');
          preparedContent = JSON.parse(fixedJson);
        }

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

      } catch (parseError) {
        console.error('Failed to prepare content:', parseError);
        return NextResponse.json({
          error: 'Failed to prepare content. Please try describing your topic differently.'
        }, { status: 400 });
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
      const { preparedContent, templateType } = body;

      if (!preparedContent) {
        return NextResponse.json({ error: 'Prepared content required' }, { status: 400 });
      }

      // Get existing canvas layout to find safe starting position
      const existingObjects = whiteboard.pages[0]?.objects || [];
      const layout = analyzeLayout(existingObjects);

      // Calculate safe starting position
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
      const placeElement = (element, isConnector = false) => {
        if (isConnector) {
          connectorElements.push(element);
        } else {
          // Register the element's bounding box
          const bounds = {
            x: element.x,
            y: element.y,
            width: element.width || 100,
            height: element.height || 50,
            id: element.id
          };
          placedElements.push(bounds);
          contentElements.push(element);
        }
        return element;
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

            // 3. PLACE ITEMS FOR THIS SECTION
            const items = section.items || [];
            const itemCount = Math.min(items.length, 6);
            
            if (itemCount > 0) {
              // Determine item placement direction based on section position
              const angleFromCenter = Math.atan2(sectionCenterY - actualCenterY, sectionCenterX - actualCenterX);
              
              // Items fan out in the direction away from center
              const itemStartAngle = angleFromCenter - Math.PI/4;
              const itemEndAngle = angleFromCenter + Math.PI/4;
              const itemAngleStep = itemCount > 1 ? (itemEndAngle - itemStartAngle) / (itemCount - 1) : 0;
              
              items.slice(0, 6).forEach((item, itemIdx) => {
                const itemText = wrapText(item, 180, 13);
                const stickyWidth = 200;
                const stickyHeight = Math.max(90, calculateTextHeight(itemText, 13) + 30);
                
                // Calculate preferred position
                const itemAngle = itemCount === 1 ? angleFromCenter : itemStartAngle + itemAngleStep * itemIdx;
                const itemDistance = 200 + (itemIdx % 2) * 50; // Stagger distances
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

              // Place step items to the side
              const items = section.items || [];
              if (items.length > 0) {
                items.slice(0, 4).forEach((item, itemIdx) => {
                  const itemText = wrapText(item, 160, 12);
                  const itemWidth = 180;
                  const itemHeight = Math.max(60, calculateTextHeight(itemText, 12) + 15);
                  const side = itemIdx % 2 === 0 ? 1 : -1;
                  const offsetY = Math.floor(itemIdx / 2) * (itemHeight + 20);
                  
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

            // 3. PLACE ITEMS SCATTERED AROUND SECTION
            const items = section.items || [];
            const itemRadius = 160;
            const itemAngleSpread = Math.PI * 0.6;
            const itemStartAngle = angle - itemAngleSpread/2;
            const itemAngleStep = items.length > 1 ? itemAngleSpread / (items.length - 1) : 0;

            items.slice(0, 5).forEach((item, itemIdx) => {
              const itemText = wrapText(item, 150, 12);
              const itemWidth = 170;
              const itemHeight = Math.max(70, calculateTextHeight(itemText, 12) + 20);
              
              const itemAngle = items.length === 1 ? angle : itemStartAngle + itemAngleStep * itemIdx;
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

        // ========== EVENT CIRCUIT LAYOUT ==========
        eventcircuit: () => {
          const sections = preparedContent.sections || [];
          if (sections.length === 0) return;

          // ═══════════════════════════════════════════════════════════════
          // LAYOUT CONFIGURATION - Using larger dimensions for clarity
          // ═══════════════════════════════════════════════════════════════
          const CARD_WIDTH = 280;
          const CARD_MIN_HEIGHT = 100;
          const CARD_GAP_X = 40;
          const SECTION_GAP_Y = 120;
          const CARDS_PER_ROW = 4;
          
          let currentY = baseY + 50;
          const centerX = baseX + 1400;

          // COLOR SCHEMES
          const colors = {
            decision_point: { fill: '#DC2626', stroke: '#991B1B', light: '#FEE2E2', text: '#FFFFFF' },
            immediate_outcomes: { fill: '#EA580C', stroke: '#C2410C', light: '#FFEDD5', text: '#FFFFFF' },
            chain_level_1: { fill: '#D97706', stroke: '#B45309', light: '#FEF3C7', text: '#FFFFFF' },
            chain_level_2: { fill: '#65A30D', stroke: '#4D7C0F', light: '#ECFCCB', text: '#FFFFFF' },
            probability_paths: { fill: '#0891B2', stroke: '#0E7490', light: '#CFFAFE', text: '#FFFFFF' },
            risk_pathways: { fill: '#DB2777', stroke: '#BE185D', light: '#FCE7F3', text: '#FFFFFF' },
            opportunity_branches: { fill: '#059669', stroke: '#047857', light: '#D1FAE5', text: '#FFFFFF' },
            critical_dependencies: { fill: '#7C3AED', stroke: '#6D28D9', light: '#EDE9FE', text: '#FFFFFF' },
            optimal_path: { fill: '#0D9488', stroke: '#0F766E', light: '#CCFBF1', text: '#FFFFFF' },
            contingency_routes: { fill: '#64748B', stroke: '#475569', light: '#F1F5F9', text: '#FFFFFF' }
          };

          const getColor = (type) => colors[type] || colors.decision_point;
          const getSection = (type) => sections.find(s => s.type === type);

          // Helper to place a row of cards and return the bottom Y position
          const placeCardsRow = (items, startY, color, maxCards = CARDS_PER_ROW) => {
            const cardCount = Math.min(items.length, maxCards);
            if (cardCount === 0) return startY;
            
            const totalWidth = cardCount * CARD_WIDTH + (cardCount - 1) * CARD_GAP_X;
            let cardX = centerX - totalWidth / 2;
            let maxBottomY = startY;

            items.slice(0, maxCards).forEach((item, idx) => {
              const text = wrapText(item, CARD_WIDTH - 30, 12);
              const cardH = Math.max(CARD_MIN_HEIGHT, calculateTextHeight(text, 12) + 40);
              
              placeElement({
                id: generateId(),
                type: 'sticky',
                x: cardX,
                y: startY,
                width: CARD_WIDTH,
                height: cardH,
                text: text,
                fillColor: color.light,
                strokeColor: color.stroke,
                strokeWidth: 2,
                borderRadius: 12,
                fontSize: 12,
                opacity: 1
              });

              // Number badge
              placeElement({
                id: generateId(),
                type: 'ellipse',
                x: cardX - 14,
                y: startY - 14,
                width: 28,
                height: 28,
                fillColor: color.fill,
                strokeColor: color.stroke,
                strokeWidth: 2,
                opacity: 1
              });
              placeElement({
                id: generateId(),
                type: 'text',
                x: cardX - 14,
                y: startY - 6,
                text: `${idx + 1}`,
                fontSize: 13,
                fontWeight: 'bold',
                fillColor: '#FFFFFF',
                width: 28,
                height: 18,
                textAlign: 'center',
                opacity: 1
              });

              maxBottomY = Math.max(maxBottomY, startY + cardH);
              cardX += CARD_WIDTH + CARD_GAP_X;
            });

            return maxBottomY;
          };

          // Helper to place a section header
          const placeSectionHeader = (title, y, color, width = 320) => {
            placeElement({
              id: generateId(),
              type: 'rect',
              x: centerX - width / 2,
              y: y,
              width: width,
              height: 45,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 2,
              borderRadius: 22,
              opacity: 1
            });
            placeElement({
              id: generateId(),
              type: 'text',
              x: centerX - width / 2 + 20,
              y: y + 12,
              text: title,
              fontSize: 14,
              fontWeight: 'bold',
              fillColor: color.text,
              width: width - 40,
              height: 22,
              textAlign: 'center',
              opacity: 1
            });
            return y + 60;
          };

          // ═══════════════════════════════════════════════════════════════
          // 1. TITLE
          // ═══════════════════════════════════════════════════════════════
          const titleText = preparedContent.title || 'Event Circuit Analysis';
          placeElement({
            id: generateId(),
            type: 'text',
            x: centerX - 450,
            y: currentY,
            text: titleText,
            fontSize: 32,
            fontWeight: 'bold',
            fillColor: '#1F2937',
            width: 900,
            height: 50,
            textAlign: 'center',
            opacity: 1
          });
          currentY += 60;

          // Description
          if (preparedContent.description) {
            const descText = wrapText(preparedContent.description, 800, 14);
            const descH = calculateTextHeight(descText, 14);
            placeElement({
              id: generateId(),
              type: 'text',
              x: centerX - 420,
              y: currentY,
              text: descText,
              fontSize: 14,
              fillColor: '#6B7280',
              width: 840,
              height: descH,
              textAlign: 'center',
              opacity: 0.9
            });
            currentY += descH + 50;
          }

          // ═══════════════════════════════════════════════════════════════
          // 2. DECISION POINT - Central hexagon with context cards below
          // ═══════════════════════════════════════════════════════════════
          const decisionSection = getSection('decision_point') || sections[0];
          const decisionColor = getColor('decision_point');
          
          // Main decision hexagon
          const hexSize = 200;
          const decisionId = generateId();
          placeElement({
            id: decisionId,
            type: 'hexagon',
            x: centerX - hexSize / 2,
            y: currentY,
            width: hexSize,
            height: hexSize,
            fillColor: decisionColor.fill,
            strokeColor: decisionColor.stroke,
            strokeWidth: 4,
            opacity: 1
          });

          // Decision title inside hexagon
          const decTitle = wrapText(decisionSection?.title || 'Core Decision', hexSize - 60, 14);
          placeElement({
            id: generateId(),
            type: 'text',
            x: centerX - hexSize / 2 + 30,
            y: currentY + hexSize / 2 - 25,
            text: decTitle,
            fontSize: 14,
            fontWeight: 'bold',
            fillColor: '#FFFFFF',
            width: hexSize - 60,
            height: 50,
            textAlign: 'center',
            opacity: 1
          });
          currentY += hexSize + 40;

          // Decision context cards
          const decisionItems = decisionSection?.items || [];
          if (decisionItems.length > 0) {
            currentY = placeCardsRow(decisionItems, currentY, decisionColor, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 3. IMMEDIATE OUTCOMES
          // ═══════════════════════════════════════════════════════════════
          const immediateSection = getSection('immediate_outcomes');
          if (immediateSection && immediateSection.items?.length > 0) {
            const color = getColor('immediate_outcomes');
            currentY = placeSectionHeader(immediateSection.title || 'Immediate Outcomes', currentY, color);
            currentY = placeCardsRow(immediateSection.items, currentY, color, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 4. CHAIN LEVEL 1
          // ═══════════════════════════════════════════════════════════════
          const chain1Section = getSection('chain_level_1');
          if (chain1Section && chain1Section.items?.length > 0) {
            const color = getColor('chain_level_1');
            currentY = placeSectionHeader(chain1Section.title || 'Chain Reactions - Level 1', currentY, color, 380);
            currentY = placeCardsRow(chain1Section.items, currentY, color, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 5. CHAIN LEVEL 2
          // ═══════════════════════════════════════════════════════════════
          const chain2Section = getSection('chain_level_2');
          if (chain2Section && chain2Section.items?.length > 0) {
            const color = getColor('chain_level_2');
            currentY = placeSectionHeader(chain2Section.title || 'Chain Reactions - Level 2', currentY, color, 380);
            currentY = placeCardsRow(chain2Section.items, currentY, color, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 6. PROBABILITY ASSESSMENT
          // ═══════════════════════════════════════════════════════════════
          const probSection = getSection('probability_paths');
          if (probSection && probSection.items?.length > 0) {
            const color = getColor('probability_paths');
            currentY = placeSectionHeader(probSection.title || 'Probability Assessment', currentY, color, 340);
            currentY = placeCardsRow(probSection.items, currentY, color, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 7. RISK vs OPPORTUNITY - Side by side
          // ═══════════════════════════════════════════════════════════════
          const riskSection = getSection('risk_pathways');
          const oppSection = getSection('opportunity_branches');

          if (riskSection || oppSection) {
            const sideWidth = 580;
            const gap = 80;
            const leftX = centerX - gap / 2 - sideWidth;
            const rightX = centerX + gap / 2;
            const startY = currentY;
            let leftY = startY;
            let rightY = startY;

            // RISK PATHWAYS (Left)
            if (riskSection && riskSection.items?.length > 0) {
              const rColor = getColor('risk_pathways');
              
              // Risk header
              placeElement({
                id: generateId(),
                type: 'rect',
                x: leftX + sideWidth / 2 - 130,
                y: leftY,
                width: 260,
                height: 45,
                fillColor: rColor.fill,
                strokeColor: rColor.stroke,
                strokeWidth: 2,
                borderRadius: 22,
                opacity: 1
              });
              placeElement({
                id: generateId(),
                type: 'text',
                x: leftX + sideWidth / 2 - 110,
                y: leftY + 12,
                text: '⚠️ Risk Pathways',
                fontSize: 14,
                fontWeight: 'bold',
                fillColor: rColor.text,
                width: 220,
                height: 22,
                textAlign: 'center',
                opacity: 1
              });
              leftY += 60;

              // Risk items (vertical list)
              riskSection.items.slice(0, 6).forEach((item, idx) => {
                const text = wrapText(item, sideWidth - 50, 12);
                const itemH = Math.max(80, calculateTextHeight(text, 12) + 30);
                
                placeElement({
                  id: generateId(),
                  type: 'sticky',
                  x: leftX + 20,
                  y: leftY,
                  width: sideWidth - 40,
                  height: itemH,
                  text: `${idx + 1}. ${text}`,
                  fillColor: rColor.light,
                  strokeColor: rColor.stroke,
                  strokeWidth: 2,
                  borderRadius: 10,
                  fontSize: 12,
                  opacity: 1
                });
                leftY += itemH + 15;
              });
            }

            // OPPORTUNITY BRANCHES (Right)
            if (oppSection && oppSection.items?.length > 0) {
              const oColor = getColor('opportunity_branches');
              
              // Opportunity header
              placeElement({
                id: generateId(),
                type: 'rect',
                x: rightX + sideWidth / 2 - 130,
                y: rightY,
                width: 260,
                height: 45,
                fillColor: oColor.fill,
                strokeColor: oColor.stroke,
                strokeWidth: 2,
                borderRadius: 22,
                opacity: 1
              });
              placeElement({
                id: generateId(),
                type: 'text',
                x: rightX + sideWidth / 2 - 110,
                y: rightY + 12,
                text: '✓ Opportunities',
                fontSize: 14,
                fontWeight: 'bold',
                fillColor: oColor.text,
                width: 220,
                height: 22,
                textAlign: 'center',
                opacity: 1
              });
              rightY += 60;

              // Opportunity items (vertical list)
              oppSection.items.slice(0, 6).forEach((item, idx) => {
                const text = wrapText(item, sideWidth - 50, 12);
                const itemH = Math.max(80, calculateTextHeight(text, 12) + 30);
                
                placeElement({
                  id: generateId(),
                  type: 'sticky',
                  x: rightX + 20,
                  y: rightY,
                  width: sideWidth - 40,
                  height: itemH,
                  text: `${idx + 1}. ${text}`,
                  fillColor: oColor.light,
                  strokeColor: oColor.stroke,
                  strokeWidth: 2,
                  borderRadius: 10,
                  fontSize: 12,
                  opacity: 1
                });
                rightY += itemH + 15;
              });
            }

            // Vertical divider
            const maxY = Math.max(leftY, rightY);
            if (riskSection && oppSection) {
              placeElement({
                id: generateId(),
                type: 'rect',
                x: centerX - 2,
                y: startY,
                width: 4,
                height: maxY - startY,
                fillColor: '#E5E7EB',
                strokeColor: '#E5E7EB',
                strokeWidth: 0,
                borderRadius: 2,
                opacity: 0.7
              });
            }

            currentY = maxY + SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 8. CRITICAL DEPENDENCIES
          // ═══════════════════════════════════════════════════════════════
          const depSection = getSection('critical_dependencies');
          if (depSection && depSection.items?.length > 0) {
            const color = getColor('critical_dependencies');
            currentY = placeSectionHeader(depSection.title || 'Critical Dependencies', currentY, color, 340);
            currentY = placeCardsRow(depSection.items, currentY, color, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 9. OPTIMAL PATH - Horizontal flow with arrows
          // ═══════════════════════════════════════════════════════════════
          const optimalSection = getSection('optimal_path');
          if (optimalSection && optimalSection.items?.length > 0) {
            const color = getColor('optimal_path');
            
            // Prominent header
            const headerW = 380;
            placeElement({
              id: generateId(),
              type: 'hexagon',
              x: centerX - headerW / 2,
              y: currentY,
              width: headerW,
              height: 55,
              fillColor: color.fill,
              strokeColor: color.stroke,
              strokeWidth: 3,
              opacity: 1
            });
            placeElement({
              id: generateId(),
              type: 'text',
              x: centerX - headerW / 2 + 40,
              y: currentY + 16,
              text: '★ OPTIMAL PATH ★',
              fontSize: 18,
              fontWeight: 'bold',
              fillColor: '#FFFFFF',
              width: headerW - 80,
              height: 24,
              textAlign: 'center',
              opacity: 1
            });
            currentY += 75;

            // Optimal steps - horizontal flow
            const stepWidth = 300;
            const stepGap = 80;
            const stepCount = Math.min(optimalSection.items.length, 5);
            const totalW = stepCount * stepWidth + (stepCount - 1) * stepGap;
            let stepX = centerX - totalW / 2;
            let prevStepId = null;
            let prevStepEndX = null;
            let maxStepH = 0;

            optimalSection.items.slice(0, 5).forEach((item, idx) => {
              const text = wrapText(item, stepWidth - 40, 13);
              const stepH = Math.max(100, calculateTextHeight(text, 13) + 50);
              maxStepH = Math.max(maxStepH, stepH);

              const stepId = generateId();
              
              // Step rectangle
              placeElement({
                id: stepId,
                type: 'rect',
                x: stepX,
                y: currentY,
                width: stepWidth,
                height: stepH,
                fillColor: color.light,
                strokeColor: color.fill,
                strokeWidth: 4,
                borderRadius: 14,
                opacity: 1
              });

              // Step text
              placeElement({
                id: generateId(),
                type: 'text',
                x: stepX + 20,
                y: currentY + 30,
                text: text,
                fontSize: 13,
                fillColor: '#134E4A',
                width: stepWidth - 40,
                height: stepH - 50,
                opacity: 1
              });

              // Step number badge
              placeElement({
                id: generateId(),
                type: 'ellipse',
                x: stepX - 20,
                y: currentY - 20,
                width: 42,
                height: 42,
                fillColor: color.fill,
                strokeColor: color.stroke,
                strokeWidth: 2,
                opacity: 1
              });
              placeElement({
                id: generateId(),
                type: 'text',
                x: stepX - 20,
                y: currentY - 10,
                text: `${idx + 1}`,
                fontSize: 18,
                fontWeight: 'bold',
                fillColor: '#FFFFFF',
                width: 42,
                height: 24,
                textAlign: 'center',
                opacity: 1
              });

              // Arrow from previous step
              if (prevStepId && prevStepEndX) {
                connectorElements.push({
                  id: generateId(),
                  type: 'connector',
                  startElementId: prevStepId,
                  endElementId: stepId,
                  startPoint: { x: prevStepEndX, y: currentY + stepH / 2, edge: 'right' },
                  endPoint: { x: stepX, y: currentY + stepH / 2, edge: 'left' },
                  points: [
                    { x: prevStepEndX, y: currentY + stepH / 2 },
                    { x: stepX, y: currentY + stepH / 2 }
                  ],
                  strokeColor: color.fill,
                  strokeWidth: 5,
                  connectorStyle: 'straight',
                  arrowEnd: true,
                  opacity: 1
                });
              }

              prevStepId = stepId;
              prevStepEndX = stepX + stepWidth;
              stepX += stepWidth + stepGap;
            });

            currentY += maxStepH + SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 10. CONTINGENCY ROUTES
          // ═══════════════════════════════════════════════════════════════
          const contSection = getSection('contingency_routes');
          if (contSection && contSection.items?.length > 0) {
            const color = getColor('contingency_routes');
            currentY = placeSectionHeader(contSection.title || 'Contingency Plans', currentY, color, 300);

            // Contingency cards with Plan A, B, C labels
            const contItems = contSection.items.map((item, idx) => 
              `Plan ${String.fromCharCode(65 + idx)}: ${item}`
            );
            currentY = placeCardsRow(contItems, currentY, color, 6);
            currentY += SECTION_GAP_Y;
          }

          // ═══════════════════════════════════════════════════════════════
          // 11. CONCLUSION
          // ═══════════════════════════════════════════════════════════════
          if (preparedContent.conclusion) {
            const conclText = wrapText(preparedContent.conclusion, 800, 14);
            const conclH = Math.max(130, calculateTextHeight(conclText, 14) + 70);
            
            placeElement({
              id: generateId(),
              type: 'sticky',
              x: centerX - 430,
              y: currentY,
              width: 860,
              height: conclH,
              text: `🎯 KEY TAKEAWAY\n\n${conclText}`,
              fillColor: '#FEF3C7',
              strokeColor: '#F59E0B',
              strokeWidth: 3,
              borderRadius: 18,
              fontSize: 14,
              opacity: 1
            });
          }
        }
      };

      // Execute the appropriate layout generator
      const generator = layoutGenerators[templateType] || layoutGenerators.mindmap;
      generator();

      // Combine content elements and connectors (connectors last)
      const generatedObjects = [...contentElements, ...connectorElements];

      // Generate a unique ID for this generation
      const generationId = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      // Tag all elements with this generation ID for tracking
      generatedObjects.forEach(obj => {
        obj.generationId = generationId;
      });

      // Add to page
      const currentPage = whiteboard.pages[0] || { objects: [] };
      currentPage.objects = [...(currentPage.objects || []), ...generatedObjects];
      whiteboard.pages[0] = currentPage;

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

      await whiteboard.save();

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
