import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { generateSmartContent } from '@/lib/promptEngine';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, []);
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.message }, { status: 401 });
    }
    const { user } = auth;

    const { prompt, context, tone = 'professional', type = 'compose' } = await request.json();

    if (!prompt && !context) {
      return NextResponse.json({ success: false, error: 'Prompt or context is required' }, { status: 400 });
    }

    // Construct system prompt
    let systemPrompt = `You are an expert AI email assistant integrated into Talio.
Your task is to help the user ${type === 'reply' ? 'reply to an email' : 'compose a new email'}.

TONE: ${tone}
FORMAT: HTML (use <p>, <br>, <ul>, <li>, <strong>, etc. where appropriate, but keep it clean)

INSTRUCTIONS:
- Write a clear, concise, and professional email based on the user's request.
- If it's a reply, address the points raised in the context.
- Do not include placeholders like "[Your Name]" unless absolutely necessary.
- Do not include the subject line in the body, just the email content.
- Use proper salutations and sign-offs.
`;

    let userMessage = '';
    if (type === 'reply' && context) {
      userMessage = `
CONTEXT (Email I am replying to):
"${context}"

MY REPLY INSTRUCTIONS:
"${prompt || 'Draft a suitable reply'}"
`;
    } else {
      userMessage = `
EMAIL TOPIC/INSTRUCTIONS:
"${prompt}"
`;
    }

    const content = await generateSmartContent(userMessage, {
      userId: user._id || user.userId,
      feature: 'mail-compose',
      systemInstruction: systemPrompt,
      skipGuardrails: true // We want HTML format, not plain text human conversation
    });

    return NextResponse.json({ success: true, content });

  } catch (error) {
    console.error('Mail AI Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to generate email' }, { status: 500 });
  }
}
