import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { generateSmartContent } from '@/lib/promptEngine';

export const dynamic = 'force-dynamic';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-key');

export async function POST(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let payload;
    try {
      const verified = await jwtVerify(token, JWT_SECRET);
      payload = verified.payload;
    } catch (err) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

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
      userId: payload.userId,
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
