import type { Difficulty, Subject, SubjectIcon, SubjectTone } from '../types'

export interface SeedTopic {
  name: string
  difficulty?: Difficulty
  minutes?: number
  points?: string[]
  formulas?: string[]
}

export interface SeedChapter {
  name: string
  weightage: number
  topics: SeedTopic[]
}

export interface SeedSubject {
  key: 'math' | 'science' | 'reasoning' | 'current'
  name: string
  shortName: string
  tone: SubjectTone
  icon: SubjectIcon
  weeklyTargetMinutes: number
  chapters: SeedChapter[]
}

/** Realistic RRB Group D / SSC oriented question bank (topics, not volume). */
export const CURRICULUM: SeedSubject[] = [
  {
    key: 'math',
    name: 'Mathematics',
    shortName: 'Maths',
    tone: 'math',
    icon: 'calculator',
    weeklyTargetMinutes: 600,
    chapters: [
      {
        name: 'Number System',
        weightage: 8,
        topics: [
          {
            name: 'Divisibility Rules & Factors',
            points: ['Rule of 3, 4, 8, 11', 'Prime factorisation', 'Number of factors formula'],
            formulas: ['Factors of N = (a+1)(b+1)...', 'Sum of factors = (p^(a+1)-1)/(p-1) × ...']
          },
          { name: 'HCF and LCM', points: ['Euclid division lemma', 'LCM × HCF = product of numbers'] },
          { name: 'Unit Digit & Remainder Theorem', difficulty: 'hard', points: ['Cyclicity of units digit', 'Successive division remainder'] }
        ]
      },
      {
        name: 'Simplification',
        weightage: 6,
        topics: [
          { name: 'BODMAS & Surds', points: ['Order of operations', 'Rationalising denominators'] },
          { name: 'Approximation Techniques' }
        ]
      },
      {
        name: 'Percentage',
        weightage: 9,
        topics: [
          { name: 'Basics of Percentage', points: ['Fraction ↔ percent conversions'], formulas: ['x% of y = (x/100) × y'] },
          { name: 'Successive Percentage Change', formulas: ['Net change = a + b + ab/100'] },
          { name: 'Percentage in Data Interpretation', difficulty: 'medium' }
        ]
      },
      {
        name: 'Profit & Loss',
        weightage: 10,
        topics: [
          {
            name: 'Cost Price, Selling Price & Profit',
            points: ['Profit% is always on CP', 'Discount% is on MP'],
            formulas: ['Profit% = (SP - CP)/CP × 100', 'SP = CP × (100 + P%)/100']
          },
          { name: 'Discount and Marked Price', formulas: ['MP = SP × 100/(100 - d%)'] },
          { name: 'Dishonest Shopkeeper Problems', difficulty: 'hard' }
        ]
      },
      {
        name: 'Ratio and Proportion',
        weightage: 8,
        topics: [
          { name: 'Basics of Ratio', points: ['Compounding ratios', 'Ratio ↔ fraction'] },
          { name: 'Partnership & Mixture Problems', difficulty: 'medium' },
          { name: 'Alligation Method', formulas: ['Ratio of quantities = (d - m) : (m - c)'] }
        ]
      },
      {
        name: 'Time and Work',
        weightage: 9,
        topics: [
          { name: 'Unitary Method in Work', formulas: ['Work = Rate × Time', '1/A + 1/B = 1/T'] },
          { name: 'Pipes and Cisterns' },
          { name: 'Efficiency Based Problems', difficulty: 'hard' }
        ]
      },
      {
        name: 'Time, Speed and Distance',
        weightage: 10,
        topics: [
          { name: 'Speed, Time & Distance Basics', formulas: ['Speed = Distance/Time', '1 km/h = 5/18 m/s'] },
          { name: 'Relative Speed & Trains', points: ['Same direction: subtract', 'Opposite: add'] },
          { name: 'Boats and Streams', formulas: ['Downstream = b + s, Upstream = b - s'] }
        ]
      },
      {
        name: 'Average',
        weightage: 6,
        topics: [
          { name: 'Basic Average', formulas: ['Average = Sum of terms / Number of terms'] },
          { name: 'Weighted Average & Replacement', difficulty: 'medium' }
        ]
      },
      {
        name: 'Simple Interest',
        weightage: 5,
        topics: [{ name: 'SI Fundamentals', formulas: ['SI = P × R × T / 100'] }]
      },
      {
        name: 'Compound Interest',
        weightage: 7,
        topics: [
          { name: 'CI Fundamentals', formulas: ['A = P(1 + R/100)^n', 'CI = A - P'] },
          { name: 'CI vs SI Difference', difficulty: 'hard' }
        ]
      }
    ]
  },
  {
    key: 'science',
    name: 'Physical Science',
    shortName: 'Science',
    tone: 'science',
    icon: 'flask',
    weeklyTargetMinutes: 540,
    chapters: [
      {
        name: 'Motion & Force',
        weightage: 10,
        topics: [
          {
            name: "Newton's Laws of Motion",
            points: ['Inertia examples', 'Action-reaction pairs'],
            formulas: ['F = ma', 'v = u + at']
          },
          { name: 'Equations of Motion', formulas: ['s = ut + ½at²', 'v² = u² + 2as'] },
          { name: 'Gravitation Basics', difficulty: 'medium', formulas: ['F = Gm₁m₂/r²'] }
        ]
      },
      {
        name: 'Work, Energy & Power',
        weightage: 8,
        topics: [
          { name: 'Work and Energy', formulas: ['W = F·d·cosθ', 'KE = ½mv²'] },
          { name: 'Power & Commercial Unit', formulas: ['P = W/t', '1 kWh = 3.6 × 10⁶ J'] }
        ]
      },
      {
        name: 'Light & Optics',
        weightage: 9,
        topics: [
          { name: 'Reflection & Mirrors', points: ['Concave vs convex usage'] , formulas: ['1/f = 1/v + 1/u'] },
          { name: 'Refraction & Lenses', difficulty: 'medium', formulas: ['n = c/v'] },
          { name: 'Human Eye & Defects', difficulty: 'hard' }
        ]
      },
      {
        name: 'Electricity & Magnetism',
        weightage: 10,
        topics: [
          { name: "Ohm's Law & Resistance", formulas: ['V = IR', 'R = ρL/A'] },
          { name: 'Series & Parallel Circuits', points: ['Series: R = R₁ + R₂', 'Parallel: 1/R = 1/R₁ + 1/R₂'] },
          { name: 'Magnetic Effect of Current', difficulty: 'medium' }
        ]
      },
      {
        name: 'Matter & Its Nature',
        weightage: 7,
        topics: [
          { name: 'States of Matter', points: ['Properties of solid/liquid/gas'] },
          { name: 'Atomic Structure', difficulty: 'medium' }
        ]
      },
      {
        name: 'Heat & Thermodynamics',
        weightage: 6,
        topics: [{ name: 'Heat Transfer & Specific Heat', formulas: ['Q = mcΔT'] }]
      },
      {
        name: 'Sound & Waves',
        weightage: 6,
        topics: [{ name: 'Wave Properties & Sound Speed', formulas: ['v = fλ'] }]
      },
      {
        name: 'Chemistry in Daily Life',
        weightage: 8,
        topics: [
          { name: 'Acids, Bases & Salts', points: ['pH scale ranges'] },
          { name: 'Common Chemicals & Uses', difficulty: 'easy' }
        ]
      }
    ]
  },
  {
    key: 'reasoning',
    name: 'Reasoning',
    shortName: 'Reasoning',
    tone: 'reasoning',
    icon: 'brain',
    weeklyTargetMinutes: 420,
    chapters: [
      {
        name: 'Series & Analogy',
        weightage: 10,
        topics: [
          { name: 'Number Series', points: ['Difference, product, square patterns'] },
          { name: 'Letter & Symbol Series', difficulty: 'medium' },
          { name: 'Analogy (Verbal & Number)', difficulty: 'easy' }
        ]
      },
      {
        name: 'Coding–Decoding',
        weightage: 9,
        topics: [
          { name: 'Letter Shift Coding' },
          { name: 'Substitution & Conditional Coding', difficulty: 'hard' }
        ]
      },
      {
        name: 'Blood Relations',
        weightage: 7,
        topics: [{ name: 'Family Tree Diagram Method', points: ['Gender symbols', 'Generation rows'] }]
      },
      {
        name: 'Direction & Distance',
        weightage: 7,
        topics: [{ name: 'Direction Sense Problems', points: ['North-East quadrant system', 'Shadow direction rules'] }]
      },
      {
        name: 'Syllogism',
        weightage: 8,
        topics: [
          { name: 'Venn Diagram Method', points: ['All / Some / No statements'] },
          { name: 'Possibility Cases', difficulty: 'hard' }
        ]
      },
      {
        name: 'Seating Arrangement',
        weightage: 10,
        topics: [
          { name: 'Linear Arrangement', difficulty: 'medium' },
          { name: 'Circular Arrangement', difficulty: 'hard' }
        ]
      },
      {
        name: 'Puzzles & Ranking',
        weightage: 9,
        topics: [{ name: 'Floor Puzzle & Ranking Order' }]
      },
      {
        name: 'Non-Verbal Reasoning',
        weightage: 8,
        topics: [
          { name: 'Mirror & Water Images' },
          { name: 'Paper Folding & Cutting', difficulty: 'medium' }
        ]
      }
    ]
  },
  {
    key: 'current',
    name: 'Current Affairs',
    shortName: 'Current',
    tone: 'current',
    icon: 'newspaper',
    weeklyTargetMinutes: 300,
    chapters: [
      {
        name: 'National Affairs',
        weightage: 10,
        topics: [
          { name: 'Government Schemes 2025', points: ['PM Vishwakarma', 'PM Surya Ghar'] },
          { name: 'Union Budget Highlights', difficulty: 'medium' },
          { name: 'New Bills & Acts' }
        ]
      },
      {
        name: 'International Affairs',
        weightage: 8,
        topics: [
          { name: 'Summits & Organisations', points: ['G20, BRICS, SCO, QUAD'] },
          { name: 'India in Global Indices', difficulty: 'medium' }
        ]
      },
      {
        name: 'Science & Technology',
        weightage: 9,
        topics: [
          { name: 'ISRO Missions', points: ['Gaganyaan', 'Chandrayaan series'] },
          { name: 'Defence & Missile Tests' }
        ]
      },
      {
        name: 'Sports & Awards',
        weightage: 7,
        topics: [
          { name: 'Recent Sports Championships' },
          { name: 'National & Civilian Awards', difficulty: 'easy' }
        ]
      },
      {
        name: 'Static GK — India',
        weightage: 10,
        topics: [
          { name: 'States, Capitals & Boundaries' },
          { name: 'National Parks & Rivers', difficulty: 'medium' },
          { name: 'Indian Polity Essentials', difficulty: 'hard' }
        ]
      }
    ]
  }
]

export const SUBJECT_ICONS: Record<SubjectIcon, string> = {
  calculator: 'Calculator',
  flask: 'FlaskConical',
  brain: 'Brain',
  newspaper: 'Newspaper',
  book: 'BookOpen'
}

export function subjectToneVars(tone: SubjectTone): { color: string; soft: string } {
  switch (tone) {
    case 'math':
      return { color: 'var(--s-math)', soft: 'var(--s-math-soft)' }
    case 'science':
      return { color: 'var(--s-science)', soft: 'var(--s-science-soft)' }
    case 'reasoning':
      return { color: 'var(--s-reasoning)', soft: 'var(--s-reasoning-soft)' }
    case 'current':
      return { color: 'var(--s-current)', soft: 'var(--s-current-soft)' }
    default:
      return { color: 'var(--purple)', soft: 'var(--purple-soft)' }
  }
}

export type { Subject }
