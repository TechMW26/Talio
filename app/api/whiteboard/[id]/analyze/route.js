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

      const prompt = `You are MAYA, an insightful AI assistant analyzing a collaborative whiteboard. ${hasScreenshot ? 'You can see the actual canvas screenshot for visual context.' : ''} Look at the canvas contents and provide genuine, thoughtful analysis like a knowledgeable colleague would.

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
        `${m.role === 'user' ? 'User' : 'MAYA'}: ${m.content}`
      ).join('\n\n');

      // Check if screenshot was provided for visual context
      const hasScreenshot = canvasScreenshot && canvasScreenshot.length > 100;

      const context = `You are MAYA, an insightful AI assistant helping with a collaborative whiteboard. ${hasScreenshot ? 'You can see the actual canvas screenshot for visual understanding.' : ''} Respond naturally without any markdown formatting, bullet points, asterisks, dashes, numbered lists, emojis, or special characters. Write in flowing prose like a helpful colleague.

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

      const generatePrompt = `You are MAYA, an elite creative consultant and visual thinking expert. You transform ideas into stunning, professional whiteboard visualizations that inspire and clarify.

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
      const continuePrompt = `You are MAYA, continuing to build a professional whiteboard visualization.

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

      const restructurePrompt = `You are MAYA, an expert at cleaning up and professionalizing whiteboard diagrams.

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
