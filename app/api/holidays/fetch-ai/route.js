import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateContent } from '@/lib/gemini'

export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Holiday } = models

    const { country, year } = await request.json()

    if (!country || !year) {
      return NextResponse.json(
        { success: false, message: 'Country and year are required' },
        { status: 400 }
      )
    }

    // Construct prompt
    const prompt = `List all major public holidays for ${country} in the year ${year}. 
    Return ONLY a valid JSON array of objects. Do not include markdown formatting or backticks.
    Each object must have these fields:
    - name: string (Name of the holiday)
    - date: string (YYYY-MM-DD format)
    - type: string (must be one of: 'public', 'optional', 'restricted')
    - description: string (short description)
    - category: string (one of: 'public', 'religious', 'cultural', 'festival')
    
    Example:
    [{"name": "New Year's Day", "date": "${year}-01-01", "type": "public", "description": "First day of the year", "category": "public"}]`

    // Use shared Gemini integration
    const text = await generateContent(prompt)
    
    // Clean up markdown if present
    let cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim()
    
    // Try to find JSON array in text if there's extra text
    const jsonMatch = cleanedText.match(/\[.*\]/s)
    if (jsonMatch) {
      cleanedText = jsonMatch[0]
    }
    
    let holidays
    try {
      holidays = JSON.parse(cleanedText)
    } catch (e) {
      console.error('JSON Parse Error:', e, 'Text:', cleanedText)
      throw new Error('Failed to parse AI response')
    }

    if (!Array.isArray(holidays)) {
      throw new Error('AI did not return an array')
    }

    // Save to database
    let addedCount = 0
    for (const h of holidays) {
      // Check if exists
      const exists = await Holiday.findOne({
        date: new Date(h.date),
        name: h.name
      })

      if (!exists) {
        await Holiday.create({
          name: h.name,
          date: new Date(h.date),
          type: h.type || 'public',
          description: h.description,
          category: h.category || 'public',
          year: parseInt(year),
          applicableTo: 'all',
          isActive: true
        })
        addedCount++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully fetched and added ${addedCount} holidays for ${country}`,
      data: holidays
    })

  } catch (error) {
    console.error('AI Fetch Error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch holidays' },
      { status: 500 }
    )
  }
}
