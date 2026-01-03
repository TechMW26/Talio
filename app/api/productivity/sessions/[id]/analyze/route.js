import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { readFile } from 'fs/promises';
import path from 'path';
import { generateVisionContent, generateContent } from '@/lib/gemini';

const MAX_IMAGES_PER_ANALYSIS = 10; // Limit images to avoid API limits

/**
 * POST /api/productivity/sessions/[id]/analyze
 * Analyze session screenshots with AI
 */
export async function POST(request, { params }) {
  try {
    const { id: sessionId } = await params;
    
    console.log(`[ProductivityAnalysis] Starting analysis for session: ${sessionId}`);
    
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User'])
    if (!auth.success) {
      console.log(`[ProductivityAnalysis] Auth failed: ${auth.message}`);
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ProductivitySession, User } = models

    const currentUserId = user._id || user.userId;
    const currentUserRole = user.role;
    
    console.log(`[ProductivityAnalysis] User: ${currentUserId}, Role: ${currentUserRole}`);
    
    // Get session
    const session = await ProductivitySession.findById(sessionId);
    if (!session) {
      console.log(`[ProductivityAnalysis] Session not found: ${sessionId}`);
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }
    
    console.log(`[ProductivityAnalysis] Session found. User field: ${session.user}, Screenshots: ${session.screenshots?.length || 0}`);
    
    // Permission check - be more lenient for department heads
    const isOwner = session.user?.toString() === currentUserId?.toString();
    const isAdminOrHR = ['admin', 'hr', 'manager', 'department_head'].includes(currentUserRole);
    const isDepartmentHead = user.isDepartmentHead === true;
    
    console.log(`[ProductivityAnalysis] Permission check - Owner: ${isOwner}, AdminHR: ${isAdminOrHR}, DeptHead: ${isDepartmentHead}`);
    
    if (!isOwner && !isAdminOrHR && !isDepartmentHead) {
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
    const userRecord = await User.findById(session.user).populate('employeeId');
    const employeeName = userRecord?.employeeId 
      ? `${userRecord.employeeId.firstName} ${userRecord.employeeId.lastName}`
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
    
    // Load images - handle both ImageKit URLs and local filesystem paths
    const images = [];
    const screenshotSummaries = [];
    
    for (const screenshot of selectedScreenshots) {
      try {
        let base64;
        let mimeType = 'image/jpeg'; // Default
        const screenshotUrl = screenshot.url || screenshot.path;
        
        // Check if it's a URL (ImageKit) or filesystem path
        if (screenshotUrl && (screenshotUrl.startsWith('http://') || screenshotUrl.startsWith('https://'))) {
          // Fetch image from URL
          console.log(`[ProductivityAnalysis] Fetching image from URL: ${screenshotUrl}`);
          const response = await fetch(screenshotUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          base64 = Buffer.from(arrayBuffer).toString('base64');
          
          // Determine mime type from URL or content-type header
          const contentType = response.headers.get('content-type');
          if (contentType) {
            mimeType = contentType.split(';')[0];
          } else if (screenshotUrl.endsWith('.webp')) {
            mimeType = 'image/webp';
          } else if (screenshotUrl.endsWith('.png')) {
            mimeType = 'image/png';
          }
        } else if (screenshotUrl) {
          // Load from filesystem (legacy)
          const imagePath = path.join(process.cwd(), 'public', screenshotUrl);
          const imageBuffer = await readFile(imagePath);
          base64 = imageBuffer.toString('base64');
          mimeType = screenshotUrl.endsWith('.webp') ? 'image/webp' : 'image/png';
        } else {
          throw new Error('No valid screenshot URL or path');
        }
        
        images.push({
          mimeType,
          data: base64
        });
        
        screenshotSummaries.push({
          screenshotPath: screenshotUrl,
          timestamp: screenshot.capturedAt || screenshot.timestamp,
          summary: '',
          activity: '',
          productivity: ''
        });
      } catch (error) {
        console.error(`Failed to load image ${screenshot.url || screenshot.path}:`, error.message);
      }
    }
    
    if (images.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to load screenshots. Images may not be accessible.' },
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
    
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession'])
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ProductivitySession } = models
    
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
