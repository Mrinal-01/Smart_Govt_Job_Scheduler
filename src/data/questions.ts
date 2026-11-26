import type { Difficulty } from '../types'

export interface SeedQuestion {
  id: string
  subjectKey: 'math' | 'science' | 'reasoning' | 'current'
  chapter: string
  topic: string
  text: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: Difficulty
  origin?: 'demo-bank' | 'ai-generated' | 'unofficial-pyq'
}

/**
 * Demo question bank. These are practice-style questions written for this
 * prototype — NOT official previous-year papers. The `origin` field keeps that
 * distinction visible in the UI.
 */
export const QUESTION_BANK: SeedQuestion[] = [
  {
    id: 'q_math_pl_1',
    subjectKey: 'math',
    chapter: 'Profit & Loss',
    topic: 'Cost Price, Selling Price & Profit',
    text: 'A shopkeeper buys an article for ₹480 and sells it for ₹552. What is the profit percentage?',
    options: ['12%', '15%', '18%', '20%'],
    correctIndex: 1,
    explanation: 'Profit = 552 − 480 = ₹72. Profit% = 72/480 × 100 = 15%.',
    difficulty: 'easy'
  },
  {
    id: 'q_math_pl_2',
    subjectKey: 'math',
    chapter: 'Profit & Loss',
    topic: 'Discount and Marked Price',
    text: 'An item marked at ₹1,200 is sold after two successive discounts of 10% and 5%. Find the selling price.',
    options: ['₹1,026', '₹1,032', '₹1,080', '₹1,022'],
    correctIndex: 0,
    explanation: 'Net discount = 10 + 5 − (10×5)/100 = 14.5%. SP = 1200 × 0.855 = ₹1,026.',
    difficulty: 'medium'
  },
  {
    id: 'q_math_pct_1',
    subjectKey: 'math',
    chapter: 'Percentage',
    topic: 'Successive Percentage Change',
    text: 'The price of an article is increased by 20% and then decreased by 20%. The net change is:',
    options: ['No change', '4% increase', '4% decrease', '2% decrease'],
    correctIndex: 2,
    explanation: 'Net change = 20 − 20 − (20×20)/100 = −4%, i.e. a 4% decrease.',
    difficulty: 'easy'
  },
  {
    id: 'q_math_tsd_1',
    subjectKey: 'math',
    chapter: 'Time, Speed and Distance',
    topic: 'Speed, Time & Distance Basics',
    text: 'A train covers 180 km in 2 hours 30 minutes. What is its average speed?',
    options: ['66 km/h', '70 km/h', '72 km/h', '75 km/h'],
    correctIndex: 2,
    explanation: 'Time = 2.5 h. Speed = 180 / 2.5 = 72 km/h.',
    difficulty: 'easy'
  },
  {
    id: 'q_math_tw_1',
    subjectKey: 'math',
    chapter: 'Time and Work',
    topic: 'Unitary Method in Work',
    text: 'A can finish a job in 12 days and B in 18 days. Working together, in how many days will they finish it?',
    options: ['6 days', '7.2 days', '7.5 days', '8 days'],
    correctIndex: 1,
    explanation: 'Combined rate = 1/12 + 1/18 = 5/36 per day. Time = 36/5 = 7.2 days.',
    difficulty: 'medium'
  },
  {
    id: 'q_math_rp_1',
    subjectKey: 'math',
    chapter: 'Ratio and Proportion',
    topic: 'Alligation Method',
    text: 'In what ratio must rice at ₹40/kg be mixed with rice at ₹55/kg to get a mixture at ₹46/kg?',
    options: ['3 : 2', '2 : 3', '5 : 2', '3 : 5'],
    correctIndex: 0,
    explanation: 'Alligation: (55 − 46) : (46 − 40) = 9 : 6 = 3 : 2.',
    difficulty: 'medium'
  },
  {
    id: 'q_math_ci_1',
    subjectKey: 'math',
    chapter: 'Compound Interest',
    topic: 'CI Fundamentals',
    text: 'Find the compound interest on ₹10,000 at 10% per annum for 2 years, compounded annually.',
    options: ['₹2,000', '₹2,100', '₹2,200', '₹2,310'],
    correctIndex: 1,
    explanation: 'A = 10000(1.1)² = ₹12,100. CI = ₹2,100.',
    difficulty: 'medium'
  },
  {
    id: 'q_math_ns_1',
    subjectKey: 'math',
    chapter: 'Number System',
    topic: 'HCF and LCM',
    text: 'The HCF of two numbers is 12 and their LCM is 144. If one number is 36, the other is:',
    options: ['24', '36', '48', '60'],
    correctIndex: 2,
    explanation: 'HCF × LCM = product. Other = (12 × 144)/36 = 48.',
    difficulty: 'easy'
  },
  {
    id: 'q_math_avg_1',
    subjectKey: 'math',
    chapter: 'Average',
    topic: 'Basic Average',
    text: 'The average of 5 numbers is 27. If one number is removed, the average becomes 25. The removed number is:',
    options: ['29', '33', '35', '37'],
    correctIndex: 2,
    explanation: 'Sum = 135. New sum = 4 × 25 = 100. Removed = 35.',
    difficulty: 'medium'
  },
  {
    id: 'q_sci_nlm_1',
    subjectKey: 'science',
    chapter: 'Motion & Force',
    topic: "Newton's Laws of Motion",
    text: 'A force of 20 N acts on a body of mass 5 kg. The acceleration produced is:',
    options: ['2 m/s²', '4 m/s²', '5 m/s²', '100 m/s²'],
    correctIndex: 1,
    explanation: 'F = ma ⇒ a = 20/5 = 4 m/s².',
    difficulty: 'easy'
  },
  {
    id: 'q_sci_wep_1',
    subjectKey: 'science',
    chapter: 'Work, Energy & Power',
    topic: 'Work and Energy',
    text: 'The kinetic energy of a body of mass 2 kg moving at 5 m/s is:',
    options: ['10 J', '20 J', '25 J', '50 J'],
    correctIndex: 2,
    explanation: 'KE = ½mv² = ½ × 2 × 25 = 25 J.',
    difficulty: 'easy'
  },
  {
    id: 'q_sci_elec_1',
    subjectKey: 'science',
    chapter: 'Electricity & Magnetism',
    topic: "Ohm's Law & Resistance",
    text: 'A resistor of 8 Ω carries a current of 1.5 A. The potential difference across it is:',
    options: ['6 V', '9.5 V', '10.5 V', '12 V'],
    correctIndex: 3,
    explanation: 'V = IR = 1.5 × 8 = 12 V.',
    difficulty: 'easy'
  },
  {
    id: 'q_sci_elec_2',
    subjectKey: 'science',
    chapter: 'Electricity & Magnetism',
    topic: 'Series & Parallel Circuits',
    text: 'Three 6 Ω resistors are connected in parallel. The equivalent resistance is:',
    options: ['18 Ω', '6 Ω', '2 Ω', '0.5 Ω'],
    correctIndex: 2,
    explanation: '1/R = 3/6 = 1/2 ⇒ R = 2 Ω.',
    difficulty: 'medium'
  },
  {
    id: 'q_sci_light_1',
    subjectKey: 'science',
    chapter: 'Light & Optics',
    topic: 'Reflection & Mirrors',
    text: 'An object placed at the centre of curvature of a concave mirror forms an image that is:',
    options: ['Virtual and enlarged', 'Real, inverted and same size', 'Real and highly diminished', 'Virtual and diminished'],
    correctIndex: 1,
    explanation: 'At C, the image is formed at C: real, inverted and of the same size.',
    difficulty: 'medium'
  },
  {
    id: 'q_sci_heat_1',
    subjectKey: 'science',
    chapter: 'Heat & Thermodynamics',
    topic: 'Heat Transfer & Specific Heat',
    text: 'The amount of heat required to raise the temperature of 2 kg of water by 10 °C (c = 4200 J/kg·°C) is:',
    options: ['42,000 J', '84,000 J', '8,400 J', '420 J'],
    correctIndex: 1,
    explanation: 'Q = mcΔT = 2 × 4200 × 10 = 84,000 J.',
    difficulty: 'medium'
  },
  {
    id: 'q_sci_sound_1',
    subjectKey: 'science',
    chapter: 'Sound & Waves',
    topic: 'Wave Properties & Sound Speed',
    text: 'A sound wave of frequency 500 Hz travels at 340 m/s. Its wavelength is:',
    options: ['0.34 m', '0.68 m', '1.47 m', '1.7 m'],
    correctIndex: 1,
    explanation: 'λ = v/f = 340/500 = 0.68 m.',
    difficulty: 'medium'
  },
  {
    id: 'q_sci_matter_1',
    subjectKey: 'science',
    chapter: 'Matter & Its Nature',
    topic: 'States of Matter',
    text: 'Which of the following has the highest intermolecular space?',
    options: ['Solids', 'Liquids', 'Gases', 'All are equal'],
    correctIndex: 2,
    explanation: 'Gases have the largest intermolecular spacing and weakest forces.',
    difficulty: 'easy'
  },
  {
    id: 'q_sci_chem_1',
    subjectKey: 'science',
    chapter: 'Chemistry in Daily Life',
    topic: 'Acids, Bases & Salts',
    text: 'The pH value of a neutral solution at 25 °C is:',
    options: ['0', '7', '10', '14'],
    correctIndex: 1,
    explanation: 'Neutral solutions have pH 7 at 25 °C.',
    difficulty: 'easy'
  },
  {
    id: 'q_re_series_1',
    subjectKey: 'reasoning',
    chapter: 'Series & Analogy',
    topic: 'Number Series',
    text: 'Find the next term: 3, 6, 11, 18, 27, ?',
    options: ['36', '38', '40', '42'],
    correctIndex: 1,
    explanation: 'Differences are 3, 5, 7, 9, 11 ⇒ 27 + 11 = 38.',
    difficulty: 'easy'
  },
  {
    id: 'q_re_series_2',
    subjectKey: 'reasoning',
    chapter: 'Series & Analogy',
    topic: 'Letter & Symbol Series',
    text: 'Complete the series: AZ, BY, CX, DW, ?',
    options: ['EV', 'EU', 'FV', 'DV'],
    correctIndex: 0,
    explanation: 'First letter moves forward, second moves backward: E and V.',
    difficulty: 'easy'
  },
  {
    id: 'q_re_code_1',
    subjectKey: 'reasoning',
    chapter: 'Coding–Decoding',
    topic: 'Letter Shift Coding',
    text: 'If CAT is coded as DBU, how is DOG coded in the same language?',
    options: ['EPH', 'EPG', 'FPH', 'DPH'],
    correctIndex: 0,
    explanation: 'Each letter shifts +1: D→E, O→P, G→H.',
    difficulty: 'easy'
  },
  {
    id: 'q_re_code_2',
    subjectKey: 'reasoning',
    chapter: 'Coding–Decoding',
    topic: 'Substitution & Conditional Coding',
    text: '“Water” is called “Food”, “Food” is called “Tree”, “Tree” is called “Sky”. What is a mango?',
    options: ['Water', 'Food', 'Tree', 'Sky'],
    correctIndex: 2,
    explanation: 'A mango is a fruit that grows on a tree; tree is called “Sky”.',
    difficulty: 'hard'
  },
  {
    id: 'q_re_blood_1',
    subjectKey: 'reasoning',
    chapter: 'Blood Relations',
    topic: 'Family Tree Diagram Method',
    text: 'Pointing to a photograph, Ravi said, “He is the son of my mother’s only daughter.” How is the boy related to Ravi?',
    options: ['Son', 'Nephew', 'Brother', 'Cousin'],
    correctIndex: 1,
    explanation: 'Mother’s only daughter is Ravi’s sister; her son is Ravi’s nephew.',
    difficulty: 'medium'
  },
  {
    id: 'q_re_dir_1',
    subjectKey: 'reasoning',
    chapter: 'Direction & Distance',
    topic: 'Direction Sense Problems',
    text: 'A man walks 5 km north, turns right and walks 3 km, turns right and walks 5 km. How far is he from the start?',
    options: ['3 km', '5 km', '8 km', '13 km'],
    correctIndex: 0,
    explanation: 'He ends 3 km east of the starting point.',
    difficulty: 'easy'
  },
  {
    id: 'q_re_syl_1',
    subjectKey: 'reasoning',
    chapter: 'Syllogism',
    topic: 'Venn Diagram Method',
    text: 'Statements: All pens are books. Some books are red. Conclusion: Some pens are red.',
    options: ['Definitely true', 'Definitely false', 'Either true or false', 'Cannot be concluded'],
    correctIndex: 3,
    explanation: 'No definite link between pens and red things — the conclusion does not follow.',
    difficulty: 'medium'
  },
  {
    id: 'q_re_seat_1',
    subjectKey: 'reasoning',
    chapter: 'Seating Arrangement',
    topic: 'Linear Arrangement',
    text: 'Five people sit in a row facing north. A is at the extreme left, E at the extreme right. B is second to the right of A. Who sits in the middle?',
    options: ['B', 'C', 'D', 'E'],
    correctIndex: 1,
    explanation: 'Order: A B C D E ⇒ C is in the middle (third position).',
    difficulty: 'medium'
  },
  {
    id: 'q_re_nonv_1',
    subjectKey: 'reasoning',
    chapter: 'Non-Verbal Reasoning',
    topic: 'Mirror & Water Images',
    text: 'The mirror image of the time 3:00 on an analog clock shows:',
    options: ['9:00', '6:00', '12:00', '3:30'],
    correctIndex: 0,
    explanation: 'Mirror time = 11:60 − 3:00 = 8:60 → 9:00.',
    difficulty: 'medium'
  },
  {
    id: 'q_re_rank_1',
    subjectKey: 'reasoning',
    chapter: 'Puzzles & Ranking',
    topic: 'Floor Puzzle & Ranking Order',
    text: 'In a class of 40 students, Rohan ranks 12th from the top. What is his rank from the bottom?',
    options: ['27th', '28th', '29th', '30th'],
    correctIndex: 2,
    explanation: 'Rank from bottom = 40 − 12 + 1 = 29.',
    difficulty: 'easy'
  },
  {
    id: 'q_cur_nat_1',
    subjectKey: 'current',
    chapter: 'National Affairs',
    topic: 'Government Schemes 2025',
    text: 'The PM Surya Ghar scheme is primarily aimed at:',
    options: [
      'Providing LPG connections',
      'Rooftop solar power for households',
      'Free coaching for competitive exams',
      'Rural road connectivity'
    ],
    correctIndex: 1,
    explanation: 'PM Surya Ghar: Muft Bijli Yojana targets rooftop solar installations for households.',
    difficulty: 'easy',
    origin: 'unofficial-pyq'
  },
  {
    id: 'q_cur_nat_2',
    subjectKey: 'current',
    chapter: 'National Affairs',
    topic: 'New Bills & Acts',
    text: 'A money bill can be introduced only in:',
    options: ['Rajya Sabha', 'Lok Sabha', 'Either House', 'Joint sitting'],
    correctIndex: 1,
    explanation: 'Under Article 110, a money bill can be introduced only in the Lok Sabha.',
    difficulty: 'easy'
  },
  {
    id: 'q_cur_int_1',
    subjectKey: 'current',
    chapter: 'International Affairs',
    topic: 'Summits & Organisations',
    text: 'The headquarters of the World Trade Organization (WTO) is located in:',
    options: ['Vienna', 'Geneva', 'New York', 'Paris'],
    correctIndex: 1,
    explanation: 'WTO is headquartered in Geneva, Switzerland.',
    difficulty: 'easy'
  },
  {
    id: 'q_cur_sci_1',
    subjectKey: 'current',
    chapter: 'Science & Technology',
    topic: 'ISRO Missions',
    text: 'Gaganyaan is India’s mission for:',
    options: ['Mars exploration', 'Human spaceflight', 'Solar observation', 'Deep-sea mining'],
    correctIndex: 1,
    explanation: 'Gaganyaan is ISRO’s human spaceflight programme.',
    difficulty: 'easy',
    origin: 'ai-generated'
  },
  {
    id: 'q_cur_sports_1',
    subjectKey: 'current',
    chapter: 'Sports & Awards',
    topic: 'National & Civilian Awards',
    text: 'The highest civilian award of India is:',
    options: ['Padma Vibhushan', 'Bharat Ratna', 'Param Vir Chakra', 'Padma Bhushan'],
    correctIndex: 1,
    explanation: 'Bharat Ratna is the Republic of India’s highest civilian award.',
    difficulty: 'easy'
  },
  {
    id: 'q_cur_static_1',
    subjectKey: 'current',
    chapter: 'Static GK — India',
    topic: 'National Parks & Rivers',
    text: 'The Kaziranga National Park is famous for:',
    options: ['Asiatic lions', 'One-horned rhinoceros', 'Bengal tigers', 'Snow leopards'],
    correctIndex: 1,
    explanation: 'Kaziranga in Assam is the stronghold of the one-horned rhinoceros.',
    difficulty: 'easy'
  },
  {
    id: 'q_cur_static_2',
    subjectKey: 'current',
    chapter: 'Static GK — India',
    topic: 'Indian Polity Essentials',
    text: 'The Directive Principles of State Policy are contained in which Part of the Constitution?',
    options: ['Part III', 'Part IV', 'Part V', 'Part VI'],
    correctIndex: 1,
    explanation: 'DPSP are in Part IV (Articles 36–51) of the Constitution.',
    difficulty: 'medium'
  },
  {
    id: 'q_cur_sports_2',
    subjectKey: 'current',
    chapter: 'Sports & Awards',
    topic: 'Recent Sports Championships',
    text: 'The Ranji Trophy is associated with which sport?',
    options: ['Hockey', 'Cricket', 'Football', 'Badminton'],
    correctIndex: 1,
    explanation: 'The Ranji Trophy is India’s premier domestic first-class cricket championship.',
    difficulty: 'easy',
    origin: 'ai-generated'
  }
]
