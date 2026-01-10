import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateSmartContent } from '@/lib/promptEngine'

export const dynamic = 'force-dynamic'

// POST - Generate AI insights for performance data using Gemini API
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, [])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user } = auth
    const token = request.headers.get('authorization')?.replace('Bearer ', '')

    // Allow access for admins, HR, managers, and check if user is a department head
    const allowedRoles = ['admin', 'hr', 'department_head', 'manager']
    
    // Always allow if user has an allowed role
    if (!allowedRoles.includes(user.role)) {
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
    const performanceSummary = `You are a performance analytics expert. Analyze this data and provide actionable insights.

IMPORTANT: Return ONLY a valid JSON object with NO markdown formatting, NO code blocks, NO extra text.

The JSON must have this EXACT structure with arrays of short, actionable bullet points:
{
  "strengths": ["Strength point 1", "Strength point 2", "Strength point 3"],
  "improvements": ["Improvement area 1", "Improvement area 2", "Improvement area 3"],
  "recommendations": ["Action item 1", "Action item 2", "Action item 3"],
  "predictions": ["Prediction 1", "Prediction 2"],
  "riskAlerts": ["Risk alert 1 if any"],
  "quickWins": ["Quick win 1", "Quick win 2"]
}

Each item should be:
- Concise (max 15 words)
- Specific with numbers/metrics
- Actionable (starts with verb for recommendations)

Performance Data:
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

Top 5 Departments:
${reportData.departmentPerformance.slice(0, 5).map(dept => 
  `${dept.department}: Score ${dept.avgScore}, Rating ${dept.avgRating}, Goals ${dept.goalCompletion}%`
).join('\n')}

Return ONLY the JSON object, nothing else.`

    try {
      const text = await generateSmartContent(performanceSummary, {
        userId: user._id || user.userId,
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
  // Try to extract bullet points from text
  const extractBullets = (section) => {
    const bullets = section
      .split(/[\n•\-\*]/)
      .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(s => s.length > 5 && s.length < 150);
    return bullets.slice(0, 5);
  };

  const sections = text.split(/\n\s*\n/);
  let strengths = [];
  let improvements = [];
  let recommendations = [];

  sections.forEach(section => {
    const lowerSection = section.toLowerCase();
    const cleaned = section.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim();
    
    if (lowerSection.includes('strength') || lowerSection.includes('positive')) {
      strengths = extractBullets(cleaned);
    } else if (lowerSection.includes('improvement') || lowerSection.includes('challenge') || lowerSection.includes('concern')) {
      improvements = extractBullets(cleaned);
    } else if (lowerSection.includes('recommendation') || lowerSection.includes('action')) {
      recommendations = extractBullets(cleaned);
    }
  });

  return {
    strengths: strengths.length > 0 ? strengths : generateStrengthsArray(reportData),
    improvements: improvements.length > 0 ? improvements : generateImprovementsArray(reportData),
    recommendations: recommendations.length > 0 ? recommendations : generateRecommendationsArray(reportData),
    predictions: generatePredictionsArray(reportData),
    riskAlerts: generateRiskAlertsArray(reportData),
    quickWins: generateQuickWinsArray(reportData),
    generatedAt: new Date().toISOString()
  };
}

function generateRuleBasedInsights(reportData) {
  const insights = {
    strengths: generateStrengthsArray(reportData),
    improvements: generateImprovementsArray(reportData),
    recommendations: generateRecommendationsArray(reportData),
    predictions: generatePredictionsArray(reportData),
    riskAlerts: generateRiskAlertsArray(reportData),
    quickWins: generateQuickWinsArray(reportData),
    generatedAt: new Date().toISOString()
  };

  return NextResponse.json({
    success: true,
    insights,
    message: 'Performance insights generated successfully'
  });
}

function generateStrengthsArray(data) {
  const strengths = [];
  
  if (parseFloat(data.avgPerformanceScore) >= 75) {
    strengths.push(`Performance score of ${data.avgPerformanceScore}/100 exceeds benchmark`);
  }
  if (parseFloat(data.productivityIndex) >= 70) {
    strengths.push(`Productivity at ${data.productivityIndex}/100 indicates efficient output`);
  }
  if (parseFloat(data.qualityScore) >= 75) {
    strengths.push(`Quality score of ${data.qualityScore}/100 meets excellence standards`);
  }
  if (parseFloat(data.goalCompletionRate) >= 70) {
    strengths.push(`${data.goalCompletionRate}% goal completion shows strong execution`);
  }
  if (data.topPerformers > 0) {
    strengths.push(`${data.topPerformers} employees performing at ≥85% level`);
  }
  const topDept = data.departmentPerformance[0];
  if (topDept && parseFloat(topDept.avgScore) >= 70) {
    strengths.push(`${topDept.department} leads with ${topDept.avgScore}/100 score`);
  }

  return strengths.length > 0 ? strengths.slice(0, 5) : ['Consistent performance across key metrics'];
}

function generateImprovementsArray(data) {
  const improvements = [];
  
  if (parseFloat(data.innovationScore) < 70) {
    improvements.push(`Innovation score at ${data.innovationScore}/100 needs focus`);
  }
  if (parseFloat(data.engagementScore) < 75) {
    improvements.push(`Engagement at ${data.engagementScore}/100 below target`);
  }
  if (parseFloat(data.projectCompletionRate) < 70) {
    improvements.push(`Project completion at ${data.projectCompletionRate}% needs improvement`);
  }
  if (parseFloat(data.avgRating) < 3.5) {
    improvements.push(`Average rating ${data.avgRating}/5 requires attention`);
  }
  const lowDepts = data.departmentPerformance.filter(d => parseFloat(d.avgScore) < 60);
  if (lowDepts.length > 0) {
    improvements.push(`${lowDepts.map(d => d.department).join(', ')} underperforming`);
  }

  return improvements.length > 0 ? improvements.slice(0, 5) : ['Maintain current levels while exploring growth'];
}

function generateRecommendationsArray(data) {
  const recommendations = [];
  
  if (parseFloat(data.innovationScore) < 70) {
    recommendations.push('Launch quarterly innovation workshops');
  }
  if (parseFloat(data.engagementScore) < 75) {
    recommendations.push('Implement monthly recognition programs');
  }
  if (parseFloat(data.goalCompletionRate) < 80) {
    recommendations.push('Establish SMART goal frameworks with weekly check-ins');
  }
  if (data.topPerformers < data.totalEmployees * 0.2) {
    recommendations.push('Create mentor-mentee pairing program');
  }
  recommendations.push('Conduct quarterly performance calibration sessions');
  recommendations.push('Invest in role-specific skill development');

  return recommendations.slice(0, 5);
}

function generatePredictionsArray(data) {
  const predictions = [];
  const avgScore = parseFloat(data.avgPerformanceScore);
  const engagement = parseFloat(data.engagementScore);
  
  if (avgScore >= 75 && engagement >= 70) {
    predictions.push('Expect 5-10% performance uplift next quarter');
  } else if (avgScore < 60) {
    predictions.push('Risk of further decline without intervention');
  }
  
  if (parseFloat(data.goalCompletionRate) >= 80) {
    predictions.push('High goal achievement likely to continue');
  }
  
  if (engagement < 60) {
    predictions.push('Attrition risk may increase in 3-6 months');
  }

  return predictions.length > 0 ? predictions.slice(0, 3) : ['Stable performance trajectory expected'];
}

function generateRiskAlertsArray(data) {
  const risks = [];
  
  if (parseFloat(data.engagementScore) < 50) {
    risks.push('Critical: Low engagement may cause attrition spike');
  }
  if (parseFloat(data.avgPerformanceScore) < 50) {
    risks.push('Warning: Performance below acceptable threshold');
  }
  const lowDepts = data.departmentPerformance.filter(d => parseFloat(d.avgScore) < 50);
  if (lowDepts.length > 0) {
    risks.push(`Alert: ${lowDepts.length} department(s) critically underperforming`);
  }

  return risks;
}

function generateQuickWinsArray(data) {
  const quickWins = [];
  
  quickWins.push('Send recognition to top performers this week');
  
  if (parseFloat(data.goalCompletionRate) < 90) {
    quickWins.push('Review incomplete goals and remove blockers');
  }
  
  const topDept = data.departmentPerformance[0];
  if (topDept) {
    quickWins.push(`Share ${topDept.department} best practices with other teams`);
  }
  
  quickWins.push('Schedule 1-on-1s with struggling employees');

  return quickWins.slice(0, 4);
}
