import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import ProductivitySession from '@/models/ProductivitySession';
import User from '@/models/User';
import { generateVisionContent, generateContent } from '@/lib/gemini';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const MAX_IMAGES_PER_ANALYSIS = 10; // Limit images to avoid API limits

/**
 * POST /api/productivity/sessions/[id]/analyze
 * Analyze session screenshots with AI
 */
export async function POST(request, { params }) {
  try {
    const { id: sessionId } = await params;
    
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    const currentUserId = decoded.payload.userId;
    const currentUserRole = decoded.payload.role;
    
    await connectDB();
    
    // Get session
    const session = await ProductivitySession.findById(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }
    
    // Permission check
    const isOwner = session.user.toString() === currentUserId;
    const isAdminOrHR = ['admin', 'hr'].includes(currentUserRole);
    
    if (!isOwner && !isAdminOrHR) {
      // TODO: Add department head check if needed
      return NextResponse.json(
        { success: false, error: 'Permission denied' },
        { status: 403 }
      );
    }
    
    // Check if already analyzed
    if (session.analysis?.isAnalyzed) {
      return NextResponse.json({
        success: true,
        message: 'Session already analyzed',
        data: session
      });
    }
    
    // Get user info for context
    const user = await User.findById(session.user).populate('employeeId');
    const employeeName = user?.employeeId 
      ? `${user.employeeId.firstName} ${user.employeeId.lastName}`
      : 'Employee';
    
    // Prepare images for analysis
    const screenshots = session.screenshots || [];
    if (screenshots.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No screenshots in session' },
        { status: 400 }
      );
    }
    
    // Select screenshots evenly distributed across the session
    const selectedIndices = selectEvenlyDistributed(screenshots.length, MAX_IMAGES_PER_ANALYSIS);
    const selectedScreenshots = selectedIndices.map(i => screenshots[i]);
    
    // Load images
    const images = [];
    const screenshotSummaries = [];
    
    for (const screenshot of selectedScreenshots) {
      try {
        const imagePath = path.join(process.cwd(), 'public', screenshot.path);
        const imageBuffer = await readFile(imagePath);
        const base64 = imageBuffer.toString('base64');
        const mimeType = screenshot.path.endsWith('.webp') ? 'image/webp' : 'image/png';
        
        images.push({
          mimeType,
          data: base64
        });
        
        screenshotSummaries.push({
          screenshotPath: screenshot.path,
          timestamp: screenshot.timestamp,
          summary: '',
          activity: '',
          productivity: ''
        });
      } catch (error) {
        console.error(`Failed to load image ${screenshot.path}:`, error.message);
      }
    }
    
    if (images.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to load screenshots' },
        { status: 500 }
      );
    }
    
    // Build analysis prompt
    const analysisPrompt = `You are analyzing productivity screenshots from an employee's work session.

Employee: ${employeeName}
Session Date: ${session.date.toISOString().split('T')[0]}
Session Time: ${session.startTime.toLocaleTimeString()} - ${session.endTime.toLocaleTimeString()}
Total Screenshots: ${screenshots.length}
Screenshots Analyzed: ${images.length}

Analyze these ${images.length} screenshots from the work session and provide a comprehensive productivity analysis.

Please respond with a JSON object containing:
{
  "summary": "A detailed 2-3 paragraph summary of what the employee worked on during this session",
  "score": <number 0-100 representing overall productivity score>,
  "achievements": ["List of key accomplishments or completed tasks"],
  "suggestions": ["List of suggestions for improvement"],
  "insights": ["Key observations about work patterns"],
  "screenshotAnalysis": [
    {
      "index": <screenshot index>,
      "summary": "Brief description of what's shown",
      "activity": "coding|browsing|meeting|document|communication|design|idle|other",
      "productivity": "high|medium|low|idle"
    }
  ],
  "applications": [
    {
      "name": "Application name",
      "category": "work|communication|entertainment|utility|other",
      "estimatedMinutes": <number>
    }
  ]
}

Be constructive and professional. Focus on identifying productive work while noting areas for improvement.`;

    let analysisResult;
    
    try {
      console.log(`[ProductivityAnalysis] Analyzing session ${sessionId} with ${images.length} images...`);
      
      const responseText = await generateVisionContent(analysisPrompt, images);
      
      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid AI response format');
      }
      
      console.log(`[ProductivityAnalysis] Analysis complete. Score: ${analysisResult.score}`);
      
    } catch (aiError) {
      console.error('[ProductivityAnalysis] AI analysis failed:', aiError.message);
      
      // Fallback: Try text-only analysis
      try {
        const fallbackPrompt = `Based on a work session with ${screenshots.length} screenshots taken between ${session.startTime.toLocaleTimeString()} and ${session.endTime.toLocaleTimeString()}, generate a placeholder productivity analysis.

Respond with JSON:
{
  "summary": "Analysis could not be completed due to image processing limitations. Please try again later.",
  "score": 50,
  "achievements": ["Session recorded successfully"],
  "suggestions": ["Retry analysis when service is available"],
  "insights": ["${screenshots.length} screenshots captured during this session"]
}`;

        const fallbackResponse = await generateContent(fallbackPrompt);
        const fallbackMatch = fallbackResponse.match(/\{[\s\S]*\}/);
        
        if (fallbackMatch) {
          analysisResult = JSON.parse(fallbackMatch[0]);
          analysisResult.error = 'Partial analysis - image processing unavailable';
        } else {
          throw new Error('Fallback analysis also failed');
        }
      } catch (fallbackError) {
        // Complete fallback
        analysisResult = {
          summary: 'AI analysis temporarily unavailable. The session has been recorded with ' + 
                   screenshots.length + ' screenshots. Please try analyzing again later.',
          score: null,
          achievements: [],
          suggestions: ['Try analyzing again when AI service is available'],
          insights: [`${screenshots.length} screenshots captured`],
          error: aiError.message
        };
      }
    }
    
    // Update screenshot summaries from analysis
    if (analysisResult.screenshotAnalysis) {
      for (const sa of analysisResult.screenshotAnalysis) {
        if (sa.index !== undefined && screenshotSummaries[sa.index]) {
          screenshotSummaries[sa.index].summary = sa.summary || '';
          screenshotSummaries[sa.index].activity = sa.activity || '';
          screenshotSummaries[sa.index].productivity = sa.productivity || '';
        }
      }
    }
    
    // Update session with analysis
    session.analysis = {
      isAnalyzed: true,
      analyzedAt: new Date(),
      summary: analysisResult.summary || '',
      score: analysisResult.score,
      achievements: analysisResult.achievements || [],
      suggestions: analysisResult.suggestions || [],
      insights: analysisResult.insights || [],
      screenshotSummaries,
      detectedApplications: (analysisResult.applications || []).map(app => ({
        name: app.name,
        duration: app.estimatedMinutes || 0,
        category: app.category || 'other'
      })),
      error: analysisResult.error || null
    };
    
    await session.save();
    
    return NextResponse.json({
      success: true,
      message: 'Session analyzed successfully',
      data: session
    });
    
  } catch (error) {
    console.error('Analyze session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to analyze session', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/productivity/sessions/[id]/analyze
 * Get analysis results for a session
 */
export async function GET(request, { params }) {
  try {
    const { id: sessionId } = await params;
    
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    await connectDB();
    
    const session = await ProductivitySession.findById(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: {
        sessionId: session._id,
        isAnalyzed: session.analysis?.isAnalyzed || false,
        analysis: session.analysis || null
      }
    });
    
  } catch (error) {
    console.error('Get analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get analysis', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Select evenly distributed indices from an array
 */
function selectEvenlyDistributed(totalCount, maxSelect) {
  if (totalCount <= maxSelect) {
    return Array.from({ length: totalCount }, (_, i) => i);
  }
  
  const indices = [];
  const step = (totalCount - 1) / (maxSelect - 1);
  
  for (let i = 0; i < maxSelect; i++) {
    indices.push(Math.round(i * step));
  }
  
  return indices;
}
