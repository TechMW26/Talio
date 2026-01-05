import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { generateContent } from '@/lib/gemini';

/**
 * POST /api/ai/generate-text
 * Generate text content using AI for various purposes
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, []);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const body = await request.json();
    const { type, context } = body;

    if (!type) {
      return NextResponse.json(
        { success: false, message: 'Type is required' },
        { status: 400 }
      );
    }

    let prompt = '';
    let systemInstruction = 'You are a professional business writing assistant. Write clear, concise, and professional content.';

    switch (type) {
      case 'project_description':
        if (!context?.projectName) {
          return NextResponse.json(
            { success: false, message: 'Project name is required' },
            { status: 400 }
          );
        }
        
        systemInstruction = `You are a professional project manager assistant. Write clear, professional project descriptions that are concise yet comprehensive. Focus on objectives, scope, and expected outcomes. Keep it to 2-3 paragraphs maximum.`;
        
        prompt = `Write a professional project description for a project named "${context.projectName}".
${context.priority ? `Priority level: ${context.priority}` : ''}
${context.department ? `Department: ${context.department}` : ''}
${context.tags ? `Related tags/keywords: ${context.tags}` : ''}

The description should:
- Clearly state the project objectives
- Outline the scope and key deliverables
- Be professional and suitable for a corporate HRMS system
- Be 2-3 paragraphs, around 100-150 words total

Write only the description, no headers or labels.`;
        break;

      case 'task_description':
        if (!context?.taskName) {
          return NextResponse.json(
            { success: false, message: 'Task name is required' },
            { status: 400 }
          );
        }
        
        systemInstruction = `You are a professional task management assistant. Write clear, actionable task descriptions that help team members understand what needs to be done.`;
        
        prompt = `Write a professional task description for a task named "${context.taskName}".
${context.projectName ? `Project: ${context.projectName}` : ''}
${context.priority ? `Priority: ${context.priority}` : ''}

The description should:
- Clearly explain what needs to be done
- Include any acceptance criteria if relevant
- Be concise (1-2 paragraphs, around 50-80 words)

Write only the description, no headers or labels.`;
        break;

      case 'announcement':
        if (!context?.title) {
          return NextResponse.json(
            { success: false, message: 'Announcement title is required' },
            { status: 400 }
          );
        }
        
        systemInstruction = `You are a professional corporate communications assistant. Write clear, engaging announcements suitable for an internal company platform.`;
        
        prompt = `Write a professional announcement for: "${context.title}".
${context.type ? `Type: ${context.type}` : ''}
${context.targetAudience ? `Target audience: ${context.targetAudience}` : ''}

The announcement should:
- Be professional yet engaging
- Clearly communicate the key message
- Be appropriate for internal company communication
- Be 1-2 paragraphs, around 80-120 words

Write only the announcement content, no headers or labels.`;
        break;

      case 'meeting_agenda':
        if (!context?.meetingTitle) {
          return NextResponse.json(
            { success: false, message: 'Meeting title is required' },
            { status: 400 }
          );
        }
        
        systemInstruction = `You are a professional meeting facilitator assistant. Create clear, structured meeting agendas.`;
        
        prompt = `Create a meeting agenda for: "${context.meetingTitle}".
${context.duration ? `Duration: ${context.duration} minutes` : ''}
${context.participants ? `Participants: ${context.participants}` : ''}

The agenda should:
- Include 3-5 main discussion points
- Be structured and time-conscious
- Include space for Q&A/discussion

Format as a simple numbered list with estimated time for each item.`;
        break;

      case 'email_draft':
        if (!context?.subject) {
          return NextResponse.json(
            { success: false, message: 'Email subject is required' },
            { status: 400 }
          );
        }
        
        systemInstruction = `You are a professional email writing assistant. Write clear, professional emails suitable for workplace communication.`;
        
        prompt = `Draft a professional email with subject: "${context.subject}".
${context.recipient ? `Recipient: ${context.recipient}` : ''}
${context.purpose ? `Purpose: ${context.purpose}` : ''}

The email should:
- Be professional and courteous
- Get to the point quickly
- Include appropriate greeting and sign-off
- Be concise (under 150 words for body)

Write the complete email including greeting and sign-off.`;
        break;

      default:
        return NextResponse.json(
          { success: false, message: `Unknown type: ${type}` },
          { status: 400 }
        );
    }

    const generatedText = await generateContent(prompt, systemInstruction);

    if (!generatedText) {
      return NextResponse.json(
        { success: false, message: 'Failed to generate content' },
        { status: 500 }
      );
    }

    // Clean up the response (remove any markdown formatting if present)
    const cleanedText = generatedText
      .replace(/^```[\s\S]*?\n/, '')
      .replace(/\n```$/, '')
      .trim();

    return NextResponse.json({
      success: true,
      text: cleanedText,
      type
    });

  } catch (error) {
    console.error('AI generate text error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to generate content', error: error.message },
      { status: 500 }
    );
  }
}
