import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { generateSmartContent } from '@/lib/promptEngine'

export const dynamic = 'force-dynamic'

// POST - Generate AI insights for performance data using Gemini API
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Allow access for admins, HR, managers, and check if user is a department head
    const allowedRoles = ['admin', 'hr', 'department_head', 'manager']
    
    // Always allow if user has an allowed role
    if (!allowedRoles.includes(decoded.role)) {
      // For other roles, check if they are a department head
      try {
        const checkHeadRes = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/team/check-head`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const checkHeadData = await checkHeadRes.json()
        
        if (!checkHeadData.success || !checkHeadData.isDepartmentHead) {
          return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
        }
      } catch (error) {
        console.error('Error checking department head status:', error)
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    const { reportData } = await request.json()

    if (!reportData) {
      return NextResponse.json({ success: false, message: 'No report data provided' }, { status: 400 })
    }

    // Prepare comprehensive performance summary
    const performanceSummary = `Analyze this performance data and provide detailed insights in strict JSON format.
    
    The JSON must have this exact structure:
    {
      "strengths": "Detailed paragraph about key strengths...",
      "improvements": "Detailed paragraph about areas for improvement...",
      "recommendations": "Detailed paragraph with actionable recommendations..."
    }

    Do not include any markdown formatting (like \`\`\`json). Just return the raw JSON object.

Performance Metrics:
- Total Employees: ${reportData.totalEmployees}
- Avg Performance Score: ${reportData.avgPerformanceScore}/100
- Avg Rating: ${reportData.avgRating}/5
- Goal Completion: ${reportData.goalCompletionRate}%
- Project Completion: ${reportData.projectCompletionRate}%
- Top Performers (≥85%): ${reportData.topPerformers}
- Productivity Index: ${reportData.productivityIndex}/100
- Quality Score: ${reportData.qualityScore}/100
- Innovation Score: ${reportData.innovationScore}/100
- Engagement Score: ${reportData.engagementScore}/100

Department Performance:
${reportData.departmentPerformance.slice(0, 5).map(dept => 
  `${dept.department}: Score ${dept.avgScore}/100, Rating ${dept.avgRating}/5, Goal ${dept.goalCompletion}%, Productivity ${dept.productivity}/100`
).join('\n')}

Provide detailed, actionable insights for leadership.`

    try {
      const text = await generateSmartContent(performanceSummary, {
        userId: decoded.userId || decoded._id,
        feature: 'performance-insights',
        skipRefinement: true, // Structured prompt
        skipGuardrails: true // We want JSON
      });
      
      let insights;
      try {
        // Clean up potential markdown code blocks
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        insights = JSON.parse(cleanText);
      } catch (e) {
        console.error('Failed to parse AI JSON:', e);
        insights = parseInsights(text, reportData);
      }

      return NextResponse.json({
        success: true,
        insights,
        message: 'AI insights generated successfully'
      })
    } catch (error) {
      console.error('Gemini API error:', error)
      return generateRuleBasedInsights(reportData)
    }

  } catch (error) {
    console.error('AI insights error:', error)
    return NextResponse.json({ success: false, message: 'Failed to generate insights' }, { status: 500 })
  }
}

function parseInsights(text, reportData) {
  const sections = text.split(/\n\s*\n/)
  let strengths = ''
  let improvements = ''
  let recommendations = ''

  sections.forEach(section => {
    const lowerSection = section.toLowerCase()
    if (lowerSection.includes('strength') || lowerSection.includes('positive')) {
      strengths = section.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim()
    } else if (lowerSection.includes('improvement') || lowerSection.includes('challenge') || lowerSection.includes('concern')) {
      improvements = section.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim()
    } else if (lowerSection.includes('recommendation') || lowerSection.includes('action')) {
      recommendations = section.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim()
    }
  })

  // Fallback parsing
  if (!strengths || !improvements || !recommendations) {
    const lines = text.split('\n').filter(line => line.trim())
    strengths = lines.slice(0, Math.floor(lines.length / 3)).join(' ')
    improvements = lines.slice(Math.floor(lines.length / 3), Math.floor(2 * lines.length / 3)).join(' ')
    recommendations = lines.slice(Math.floor(2 * lines.length / 3)).join(' ')
  }

  return {
    strengths: strengths || generateStrengthsText(reportData),
    improvements: improvements || generateImprovementsText(reportData),
    recommendations: recommendations || generateRecommendationsText(reportData),
    fullAnalysis: text,
    generatedAt: new Date().toISOString()
  }
}

function generateRuleBasedInsights(reportData) {
  const insights = {
    strengths: generateStrengthsText(reportData),
    improvements: generateImprovementsText(reportData),
    recommendations: generateRecommendationsText(reportData),
    generatedAt: new Date().toISOString()
  }

  return NextResponse.json({
    success: true,
    insights,
    message: 'Performance insights generated successfully'
  })
}

function generateStrengthsText(data) {
  const strengths = []
  
  if (parseFloat(data.avgPerformanceScore) >= 75) {
    strengths.push(`Strong overall performance with an average score of ${data.avgPerformanceScore}/100`)
  }
  
  if (parseFloat(data.productivityIndex) >= 70) {
    strengths.push(`High productivity index at ${data.productivityIndex}/100`)
  }
  
  if (parseFloat(data.qualityScore) >= 75) {
    strengths.push(`Excellent quality standards with a score of ${data.qualityScore}/100`)
  }
  
  if (parseFloat(data.goalCompletionRate) >= 70) {
    strengths.push(`${data.goalCompletionRate}% goal completion rate demonstrates strong execution`)
  }

  if (data.topPerformers > 0) {
    strengths.push(`${data.topPerformers} top performers (≥85%) driving excellence`)
  }

  const topDept = data.departmentPerformance[0]
  if (topDept) {
    strengths.push(`${topDept.department} department leads with ${topDept.avgScore}/100 performance score`)
  }

  return strengths.length > 0 
    ? strengths.join('. ') + '.'
    : 'The organization shows consistent performance across key metrics with strong departmental collaboration.'
}

function generateImprovementsText(data) {
  const improvements = []
  
  if (parseFloat(data.innovationScore) < 70) {
    improvements.push(`Innovation score at ${data.innovationScore}/100 needs attention`)
  }
  
  if (parseFloat(data.engagementScore) < 75) {
    improvements.push(`Employee engagement at ${data.engagementScore}/100 requires focus`)
  }
  
  if (parseFloat(data.projectCompletionRate) < 70) {
    improvements.push(`Project completion rate of ${data.projectCompletionRate}% should be improved`)
  }

  if (parseFloat(data.avgRating) < 3.5) {
    improvements.push(`Average rating of ${data.avgRating}/5 indicates room for improvement`)
  }

  const lowPerformingDepts = data.departmentPerformance.filter(d => parseFloat(d.avgScore) < 60)
  if (lowPerformingDepts.length > 0) {
    improvements.push(`${lowPerformingDepts.map(d => d.department).join(', ')} department(s) need performance enhancement`)
  }

  return improvements.length > 0
    ? improvements.join('. ') + '.'
    : 'Focus on maintaining current performance levels while exploring opportunities for innovation and employee engagement.'
}

function generateRecommendationsText(data) {
  const recommendations = []
  
  if (parseFloat(data.innovationScore) < 70) {
    recommendations.push('Implement innovation workshops and brainstorming sessions quarterly')
  }
  
  if (parseFloat(data.engagementScore) < 75) {
    recommendations.push('Launch employee engagement initiatives including team-building activities and recognition programs')
  }
  
  if (parseFloat(data.goalCompletionRate) < 80) {
    recommendations.push('Establish SMART goal-setting frameworks and monthly progress reviews')
  }
  
  if (data.topPerformers < data.totalEmployees * 0.2) {
    recommendations.push('Create mentorship programs pairing top performers with developing team members')
  }

  recommendations.push('Conduct quarterly performance calibration sessions across departments')
  recommendations.push('Invest in skill development programs aligned with department-specific needs')

  return recommendations.slice(0, 5).join('. ') + '.'
}
