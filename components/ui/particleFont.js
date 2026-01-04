/**
 * Particle Font System - Smooth Handwritten Style
 * 
 * Characters are defined as bezier curve strokes that get sampled
 * to create smooth, flowing text with uniform particle density.
 * No pixel grid - pure curves for a natural, handwritten feel.
 */

// Each character is an array of strokes (paths)
// Each stroke is an array of points that define a bezier curve
// Points are normalized 0-1 coordinates within character bounds

const CHAR_STROKES = {
  // Uppercase - Elegant, slightly rounded
  'A': [
    [[0, 1], [0.2, 0.5], [0.5, 0]],           // Left stroke up to peak
    [[0.5, 0], [0.8, 0.5], [1, 1]],           // Right stroke down
    [[0.15, 0.6], [0.5, 0.6], [0.85, 0.6]]    // Crossbar
  ],
  'B': [
    [[0, 1], [0, 0.5], [0, 0]],               // Vertical stem
    [[0, 0], [0.6, 0], [0.8, 0.15], [0.6, 0.35], [0, 0.35]],  // Top bump
    [[0, 0.35], [0.7, 0.35], [0.9, 0.55], [0.7, 0.85], [0, 1]] // Bottom bump
  ],
  'C': [
    [[0.9, 0.15], [0.6, 0], [0.2, 0], [0, 0.3], [0, 0.7], [0.2, 1], [0.6, 1], [0.9, 0.85]]
  ],
  'D': [
    [[0, 1], [0, 0]],                         // Vertical stem
    [[0, 0], [0.5, 0], [1, 0.3], [1, 0.7], [0.5, 1], [0, 1]]  // Curved part
  ],
  'E': [
    [[0.8, 0], [0, 0], [0, 0.5], [0.6, 0.5]], // Top and middle
    [[0, 0.5], [0, 1], [0.8, 1]]              // Bottom
  ],
  'F': [
    [[0.8, 0], [0, 0], [0, 1]],               // Vertical and top
    [[0, 0.45], [0.55, 0.45]]                 // Middle bar
  ],
  'G': [
    [[0.85, 0.2], [0.5, 0], [0.15, 0.15], [0, 0.5], [0.15, 0.85], [0.5, 1], [0.85, 0.85], [0.85, 0.55], [0.5, 0.55]]
  ],
  'H': [
    [[0, 0], [0, 1]],                         // Left stem
    [[1, 0], [1, 1]],                         // Right stem
    [[0, 0.5], [1, 0.5]]                      // Crossbar
  ],
  'I': [
    [[0.3, 0], [0.7, 0]],                     // Top serif
    [[0.5, 0], [0.5, 1]],                     // Stem
    [[0.3, 1], [0.7, 1]]                      // Bottom serif
  ],
  'J': [
    [[0.2, 0], [0.8, 0]],                     // Top
    [[0.6, 0], [0.6, 0.75], [0.4, 1], [0.1, 0.85]] // Curved stem
  ],
  'K': [
    [[0, 0], [0, 1]],                         // Stem
    [[0.9, 0], [0, 0.5]],                     // Upper diagonal
    [[0.2, 0.4], [0.9, 1]]                    // Lower diagonal
  ],
  'L': [
    [[0, 0], [0, 1], [0.85, 1]]
  ],
  'M': [
    [[0, 1], [0, 0]],                         // Left stem
    [[0, 0], [0.5, 0.45]],                    // Left diagonal down
    [[0.5, 0.45], [1, 0]],                    // Right diagonal up
    [[1, 0], [1, 1]]                          // Right stem
  ],
  'N': [
    [[0, 1], [0, 0]],                         // Left stem
    [[0, 0], [1, 1]],                         // Diagonal
    [[1, 1], [1, 0]]                          // Right stem
  ],
  'O': [
    [[0.5, 0], [0.15, 0.1], [0, 0.5], [0.15, 0.9], [0.5, 1], [0.85, 0.9], [1, 0.5], [0.85, 0.1], [0.5, 0]]
  ],
  'P': [
    [[0, 1], [0, 0]],                         // Stem
    [[0, 0], [0.6, 0], [0.9, 0.15], [0.9, 0.35], [0.6, 0.5], [0, 0.5]]
  ],
  'Q': [
    [[0.5, 0], [0.15, 0.1], [0, 0.5], [0.15, 0.9], [0.5, 1], [0.85, 0.9], [1, 0.5], [0.85, 0.1], [0.5, 0]],
    [[0.6, 0.75], [0.95, 1.05]]               // Tail
  ],
  'R': [
    [[0, 1], [0, 0]],                         // Stem
    [[0, 0], [0.6, 0], [0.85, 0.12], [0.85, 0.35], [0.6, 0.48], [0, 0.48]],
    [[0.4, 0.48], [0.9, 1]]                   // Leg
  ],
  'S': [
    [[0.85, 0.15], [0.6, 0], [0.25, 0.05], [0.1, 0.2], [0.2, 0.4], [0.8, 0.6], [0.9, 0.8], [0.75, 0.95], [0.4, 1], [0.15, 0.85]]
  ],
  'T': [
    [[0, 0], [1, 0]],                         // Top bar
    [[0.5, 0], [0.5, 1]]                      // Stem
  ],
  'U': [
    [[0, 0], [0, 0.7], [0.2, 0.95], [0.5, 1], [0.8, 0.95], [1, 0.7], [1, 0]]
  ],
  'V': [
    [[0, 0], [0.5, 1]],                       // Left diagonal
    [[0.5, 1], [1, 0]]                        // Right diagonal
  ],
  'W': [
    [[0, 0], [0.25, 1]],                      // First down stroke
    [[0.25, 1], [0.5, 0.4]],                  // First up stroke
    [[0.5, 0.4], [0.75, 1]],                  // Second down stroke
    [[0.75, 1], [1, 0]]                       // Second up stroke
  ],
  'X': [
    [[0, 0], [1, 1]],
    [[1, 0], [0, 1]]
  ],
  'Y': [
    [[0, 0], [0.5, 0.5]],
    [[1, 0], [0.5, 0.5], [0.5, 1]]
  ],
  'Z': [
    [[0, 0], [1, 0], [0, 1], [1, 1]]
  ],

  // Lowercase - More curved and flowing
  'a': [
    [[0.8, 0.35], [0.6, 0.25], [0.3, 0.3], [0.15, 0.5], [0.25, 0.75], [0.5, 0.85], [0.75, 0.75], [0.8, 0.55]],
    [[0.8, 0.35], [0.8, 1]]
  ],
  'b': [
    [[0.1, 0], [0.1, 1]],
    [[0.1, 0.4], [0.3, 0.28], [0.6, 0.3], [0.85, 0.5], [0.85, 0.75], [0.6, 0.95], [0.3, 0.95], [0.1, 0.75]]
  ],
  'c': [
    [[0.85, 0.4], [0.6, 0.28], [0.3, 0.32], [0.1, 0.55], [0.1, 0.75], [0.3, 0.95], [0.6, 0.95], [0.85, 0.85]]
  ],
  'd': [
    [[0.9, 0], [0.9, 1]],
    [[0.9, 0.75], [0.7, 0.95], [0.4, 0.95], [0.15, 0.75], [0.15, 0.5], [0.4, 0.3], [0.7, 0.32], [0.9, 0.45]]
  ],
  'e': [
    [[0.15, 0.6], [0.85, 0.6], [0.85, 0.45], [0.6, 0.28], [0.3, 0.32], [0.1, 0.55], [0.15, 0.8], [0.4, 0.98], [0.75, 0.92]]
  ],
  'f': [
    [[0.85, 0.15], [0.6, 0.02], [0.4, 0.1], [0.35, 0.35], [0.35, 1]],
    [[0.15, 0.45], [0.65, 0.45]]
  ],
  'g': [
    [[0.85, 0.35], [0.6, 0.25], [0.3, 0.3], [0.15, 0.5], [0.25, 0.7], [0.5, 0.78], [0.75, 0.7], [0.85, 0.5]],
    [[0.85, 0.35], [0.85, 1.1], [0.6, 1.25], [0.25, 1.15]]
  ],
  'h': [
    [[0.1, 0], [0.1, 1]],
    [[0.1, 0.5], [0.35, 0.32], [0.65, 0.32], [0.85, 0.5], [0.85, 1]]
  ],
  'i': [
    [[0.5, 0.15], [0.52, 0.18]],              // Dot
    [[0.5, 0.38], [0.5, 1]]
  ],
  'j': [
    [[0.6, 0.15], [0.62, 0.18]],              // Dot
    [[0.6, 0.38], [0.6, 1.1], [0.35, 1.25], [0.1, 1.1]]
  ],
  'k': [
    [[0.15, 0], [0.15, 1]],
    [[0.8, 0.35], [0.15, 0.7]],
    [[0.35, 0.58], [0.85, 1]]
  ],
  'l': [
    [[0.45, 0], [0.48, 0.85], [0.55, 1], [0.7, 0.98]]
  ],
  'm': [
    [[0.05, 1], [0.05, 0.45], [0.2, 0.32], [0.35, 0.38], [0.4, 0.55], [0.4, 1]],
    [[0.4, 0.55], [0.55, 0.32], [0.75, 0.32], [0.9, 0.5], [0.9, 1]]
  ],
  'n': [
    [[0.1, 1], [0.1, 0.4], [0.35, 0.28], [0.65, 0.3], [0.85, 0.48], [0.85, 1]]
  ],
  'o': [
    [[0.5, 0.3], [0.2, 0.38], [0.1, 0.6], [0.2, 0.88], [0.5, 0.98], [0.8, 0.88], [0.9, 0.6], [0.8, 0.38], [0.5, 0.3]]
  ],
  'p': [
    [[0.1, 0.35], [0.1, 1.25]],
    [[0.1, 0.5], [0.3, 0.32], [0.6, 0.32], [0.85, 0.5], [0.85, 0.72], [0.6, 0.92], [0.3, 0.92], [0.1, 0.75]]
  ],
  'q': [
    [[0.9, 0.35], [0.9, 1.25]],
    [[0.9, 0.5], [0.7, 0.32], [0.4, 0.32], [0.15, 0.5], [0.15, 0.72], [0.4, 0.92], [0.7, 0.92], [0.9, 0.75]]
  ],
  'r': [
    [[0.15, 1], [0.15, 0.45], [0.35, 0.32], [0.6, 0.32], [0.85, 0.42]]
  ],
  's': [
    [[0.8, 0.4], [0.55, 0.3], [0.25, 0.38], [0.2, 0.52], [0.45, 0.62], [0.7, 0.72], [0.75, 0.85], [0.5, 0.98], [0.2, 0.88]]
  ],
  't': [
    [[0.4, 0.15], [0.4, 0.85], [0.55, 1], [0.75, 0.95]],
    [[0.2, 0.4], [0.7, 0.4]]
  ],
  'u': [
    [[0.1, 0.35], [0.1, 0.75], [0.3, 0.98], [0.6, 0.95], [0.85, 0.75]],
    [[0.85, 0.35], [0.85, 1]]
  ],
  'v': [
    [[0.1, 0.35], [0.5, 1], [0.9, 0.35]]
  ],
  'w': [
    [[0.05, 0.35], [0.25, 1], [0.5, 0.6], [0.75, 1], [0.95, 0.35]]
  ],
  'x': [
    [[0.1, 0.35], [0.9, 1]],
    [[0.9, 0.35], [0.1, 1]]
  ],
  'y': [
    [[0.1, 0.35], [0.5, 0.85]],
    [[0.9, 0.35], [0.45, 1.0], [0.25, 1.2], [0.1, 1.1]]
  ],
  'z': [
    [[0.15, 0.38], [0.85, 0.38], [0.15, 1], [0.85, 1]]
  ],

  // Numbers
  '0': [
    [[0.5, 0.05], [0.15, 0.2], [0.05, 0.5], [0.15, 0.85], [0.5, 1], [0.85, 0.85], [0.95, 0.5], [0.85, 0.2], [0.5, 0.05]]
  ],
  '1': [
    [[0.25, 0.2], [0.5, 0.02], [0.5, 1]],
    [[0.25, 1], [0.75, 1]]
  ],
  '2': [
    [[0.1, 0.2], [0.3, 0.02], [0.7, 0.02], [0.9, 0.2], [0.85, 0.4], [0.1, 1], [0.9, 1]]
  ],
  '3': [
    [[0.15, 0.1], [0.5, 0], [0.85, 0.15], [0.8, 0.4], [0.5, 0.5]],
    [[0.5, 0.5], [0.9, 0.6], [0.9, 0.85], [0.55, 1], [0.15, 0.9]]
  ],
  '4': [
    [[0.7, 1], [0.7, 0], [0.05, 0.65], [0.95, 0.65]]
  ],
  '5': [
    [[0.85, 0.02], [0.2, 0.02], [0.15, 0.45], [0.5, 0.4], [0.85, 0.55], [0.85, 0.8], [0.5, 1], [0.15, 0.88]]
  ],
  '6': [
    [[0.75, 0.08], [0.4, 0], [0.12, 0.3], [0.08, 0.7], [0.3, 0.98], [0.65, 0.98], [0.88, 0.75], [0.85, 0.55], [0.55, 0.42], [0.25, 0.55]]
  ],
  '7': [
    [[0.1, 0.02], [0.9, 0.02], [0.4, 1]]
  ],
  '8': [
    [[0.5, 0.48], [0.2, 0.35], [0.2, 0.15], [0.5, 0.02], [0.8, 0.15], [0.8, 0.35], [0.5, 0.48]],
    [[0.5, 0.48], [0.15, 0.65], [0.15, 0.85], [0.5, 1], [0.85, 0.85], [0.85, 0.65], [0.5, 0.48]]
  ],
  '9': [
    [[0.25, 0.92], [0.6, 1], [0.88, 0.7], [0.92, 0.3], [0.7, 0.02], [0.35, 0.02], [0.12, 0.25], [0.15, 0.45], [0.45, 0.58], [0.75, 0.45]]
  ],

  // Special characters
  ' ': [],
  '.': [[[0.5, 0.9], [0.52, 0.95], [0.5, 1], [0.48, 0.95], [0.5, 0.9]]],
  ',': [[[0.5, 0.85], [0.55, 0.95], [0.45, 1.15]]],
  '!': [
    [[0.5, 0], [0.48, 0.6]],
    [[0.5, 0.85], [0.5, 0.9]]
  ],
  '?': [
    [[0.15, 0.15], [0.4, 0], [0.75, 0.05], [0.9, 0.25], [0.75, 0.45], [0.5, 0.55], [0.5, 0.7]],
    [[0.5, 0.88], [0.5, 0.92]]
  ],
  '-': [[[0.2, 0.5], [0.8, 0.5]]],
  "'": [[[0.5, 0.05], [0.45, 0.2]]],
  ':': [
    [[0.5, 0.35], [0.52, 0.38]],
    [[0.5, 0.85], [0.52, 0.88]]
  ],
}

// Character dimensions
export const CHAR_WIDTH = 1.0   // Normalized width
export const CHAR_HEIGHT = 1.2  // Normalized height (allows for descenders)

// AI Loading Messages
export const AI_MESSAGES = [
  "M ira is thinking",
  "Just a moment",
  "Working on it",
  "Almost there",
  "Analyzing",
  "On it",
  "Processing",
  "One moment"
]

/**
 * Sample points along a bezier curve path
 */
function samplePath(points, numSamples) {
  const samples = []
  if (points.length < 2) return samples
  
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples
    const point = getPointOnPath(points, t)
    samples.push(point)
  }
  return samples
}

/**
 * Get a point along a path using Catmull-Rom interpolation for smoothness
 */
function getPointOnPath(points, t) {
  if (points.length === 2) {
    // Linear interpolation
    return [
      points[0][0] + (points[1][0] - points[0][0]) * t,
      points[0][1] + (points[1][1] - points[0][1]) * t
    ]
  }
  
  // For multiple points, use bezier curve
  const n = points.length - 1
  let x = 0, y = 0
  
  for (let i = 0; i <= n; i++) {
    const basis = bernstein(n, i, t)
    x += points[i][0] * basis
    y += points[i][1] * basis
  }
  
  return [x, y]
}

/**
 * Bernstein basis polynomial
 */
function bernstein(n, i, t) {
  return binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i)
}

/**
 * Binomial coefficient
 */
function binomial(n, k) {
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 1; i <= k; i++) {
    result = result * (n - k + i) / i
  }
  return result
}

/**
 * Convert text to particle positions using smooth bezier strokes
 */
export function textToParticles(text, scale = 30, centerX = 0, centerY = 0) {
  const particles = []
  const chars = text.split('')
  
  // Tighter letter spacing
  const letterSpacing = scale * 0.72
  const totalWidth = chars.length * letterSpacing
  let startX = centerX - totalWidth / 2
  
  chars.forEach((char, charIndex) => {
    const charUpper = char.toUpperCase()
    let strokes = CHAR_STROKES[char] || CHAR_STROKES[charUpper]
    if (!strokes || strokes.length === 0) return
    
    const charX = startX + charIndex * letterSpacing
    const isLowercase = char === char.toLowerCase() && char !== char.toUpperCase()
    const charScale = isLowercase ? scale * 0.7 : scale
    const yOffset = isLowercase ? scale * 0.15 : 0
    
    strokes.forEach(stroke => {
      // Sample more points for longer strokes
      const pathLength = estimatePathLength(stroke)
      const samplesPerUnit = 3.5  // Density of particles along path
      const numSamples = Math.max(8, Math.floor(pathLength * samplesPerUnit * scale / 10))
      
      const pathPoints = samplePath(stroke, numSamples)
      
      pathPoints.forEach((point, idx) => {
        // Add main particle
        const shouldOscillate = Math.random() < 0.2
        
        particles.push({
          x: charX + point[0] * charScale,
          y: centerY + (point[1] * charScale) - (charScale * 0.5) + yOffset,
          z: (Math.random() - 0.5) * 3,
          oscillate: shouldOscillate,
          oscillateSpeed: 0.6 + Math.random() * 1.0,
          oscillateAmount: scale * 0.08 * (0.5 + Math.random() * 0.5)
        })
        
        // Add nearby particles for density (smooth fill)
        const extraCount = Math.random() < 0.6 ? 2 : 1
        for (let i = 0; i < extraCount; i++) {
          const spread = scale * 0.04
          particles.push({
            x: charX + point[0] * charScale + (Math.random() - 0.5) * spread,
            y: centerY + (point[1] * charScale) - (charScale * 0.5) + yOffset + (Math.random() - 0.5) * spread,
            z: (Math.random() - 0.5) * 4,
            oscillate: shouldOscillate && Math.random() < 0.3,
            oscillateSpeed: 0.6 + Math.random() * 1.0,
            oscillateAmount: scale * 0.06 * (0.5 + Math.random() * 0.5)
          })
        }
      })
    })
  })
  
  return particles
}

/**
 * Estimate path length for determining sample count
 */
function estimatePathLength(points) {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i-1][0]
    const dy = points[i][1] - points[i-1][1]
    length += Math.sqrt(dx * dx + dy * dy)
  }
  return length
}

/**
 * Get a random AI message
 */
export function getRandomAIMessage() {
  return AI_MESSAGES[Math.floor(Math.random() * AI_MESSAGES.length)]
}

export default CHAR_STROKES
