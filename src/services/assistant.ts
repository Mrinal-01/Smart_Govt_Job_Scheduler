import type { AIMessage, AIMode, StudyState } from '../types'
import {
  allTopics,
  chapterAccuracy,
  chapterStatus,
  consistencyFor,
  dueRevisions,
  logsInRange,
  streakFor,
  subjectProgress,
  topicMastery
} from '../store/selectors'
import { addDays, dateKey, formatDuration, formatShortDate } from '../lib/date'
import { pct, round, sum } from '../lib/utils'

/**
 * Local, deterministic "demo assistant".
 *
 * This is NOT an AI model. It is a rules-based responder over the user's real
 * local study data, every message flagged `demo: true` in the UI. The same
 * prompts can be sent to POST /api/v1/ai/chat once an OpenAI key lives on the
 * server — see docs/API_CONTRACT.md § AI.
 */

export interface AssistantReply {
  content: string
  suggestions: string[]
}

function weakTopicList(state: StudyState, limit = 3) {
  return allTopics(state)
    .filter((t) => t.initialLearningDate)
    .map((t) => ({ topic: t, mastery: topicMastery(t) }))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, limit)
}

function subjectSummaryLine(state: StudyState): string {
  return state.subjects
    .map((s) => {
      const p = subjectProgress(state, s.id)
      return `• **${s.name}** — ${p.topicsLearned}/${p.topics} topics learnt · ${p.revisions} revisions · ${p.accuracy}% accuracy`
    })
    .join('\n')
}

export function respond(mode: AIMode, prompt: string, state: StudyState): AssistantReply {
  const today = dateKey()
  const due = dueRevisions(state, today)
  const streak = streakFor(state, today)
  const week = logsInRange(state, addDays(today, -6), today)
  const weekMinutes = sum(week.map((d) => d.actualMinutes))

  if (mode === 'weekly-report') {
    const planned = sum(week.map((d) => d.plannedMinutes))
    const consistency = consistencyFor(state, 7, today)
    const attempts = state.attempts.filter((a) => a.submittedAt.slice(0, 10) >= addDays(today, -6))
    const avgAccuracy = attempts.length ? Math.round(sum(attempts.map((a) => a.accuracy)) / attempts.length) : 0
    const weak = weakTopicList(state, 3)
    return {
      content: `### Weekly progress report (demo data)

**Study time:** ${formatDuration(weekMinutes)} of ${formatDuration(planned)} planned (${pct(weekMinutes, planned)}%)
**Consistency:** ${consistency}% of the last 7 days hit the study target
**Current streak:** ${streak.current} days
**Mock tests:** ${attempts.length}${attempts.length ? ` · average accuracy ${avgAccuracy}%` : ''}

${subjectSummaryLine(state)}

**Suggested focus for next week**
${weak.map((w, i) => `${i + 1}. ${w.topic.name} — mastery ${w.mastery}/100, ${w.topic.revisions.length} revisions logged`).join('\n')}

**One concrete change:** your weakest subject is where accuracy dips most. Move one of its sessions earlier in the day (before 11 AM) — decision-quality is highest then, and it is the cheapest way to lift a stubborn accuracy score.

_Rules-based demo output. Connect the backend to receive a model-generated report._`,
      suggestions: ['What should I revise today?', 'Which chapters are weakest?', 'Generate a quiz on Profit & Loss']
    }
  }

  if (mode === 'smart-revision') {
    const top = due.slice(0, 6)
    return {
      content: top.length
        ? `### Smart revision plan for ${formatShortDate(today)}

You have **${due.length} topic${due.length === 1 ? '' : 's'}** past their revision date. Priority order:

${top
  .map((d, i) => {
    const mastery = topicMastery(d.topic)
    const reason =
      d.topic.mistakeCount > 0
        ? `${d.topic.mistakeCount} logged mistake${d.topic.mistakeCount === 1 ? '' : 's'}`
        : mastery < 60
          ? 'low mastery score'
          : `${d.daysOverdue}d overdue`
    return `${i + 1}. **${d.topic.name}** (${d.subject.name}) — ${reason}, mastery ${mastery}/100`
  })
  .join('\n')}

**How to spend the next 40 minutes**
- 10 min: re-read formula/notes for items 1–2
- 20 min: resolve the linked mistakes in the Mistake Bank
- 10 min: 10 quick questions on item 1, mark confidence

Skipping a revision pushes the interval forward but keeps the mastery penalty — the scheduler will re-surface it.

_Rules-based demo output, computed from your local revision history._`
      : `### Nothing overdue

All revision dates are in the future. Keep the current rhythm — the next spaced-repetition slab lands on ${formatShortDate(addDays(today, 1))}. Use the free time for a chapter-wise mock test instead.

_Rules-based demo output._`,
      suggestions: ['Show my weakest topics', 'Plan tomorrow for me', 'Weekly report']
    }
  }

  if (mode === 'weak-topics') {
    const weak = weakTopicList(state, 4)
    const weakChapters = state.chapters
      .filter((c) => chapterStatus(c) !== 'not-started' && chapterAccuracy(c) < 72)
      .slice(0, 4)
    return {
      content: `### Weak-area analysis (demo data)

**Lowest mastery topics**
${weak.map((w, i) => `${i + 1}. ${w.topic.name} — ${w.mastery}/100 · ${w.topic.questionsAttempted} questions · ${w.topic.mistakeCount} mistakes`).join('\n')}

**Chapters under 72% accuracy**
${
  weakChapters.length
    ? weakChapters.map((c) => `• ${c.name} — ${chapterAccuracy(c)}%`).join('\n')
    : '• None — every started chapter is above 72%.'
}

**Diagnosis**
${
  weak.length && weak[0].topic.mistakeCount >= 2
    ? `Your weakest topic has repeated mistakes, which usually means a **conceptual** gap rather than speed. Do one worked example set (5 questions) before attempting timed practice.`
    : `Errors look spread out rather than clustered, which points to **careless calculation** more than weak concepts. Add a 60-second answer-check ritual to each practice set.`
}

_Rules-based demo output from your topic and mistake records._`,
      suggestions: ['Build a revision plan', 'Generate a quiz on my weakest topic', 'Weekly report']
    }
  }

  if (mode === 'quiz') {
    const topic = prompt.replace(/generate (a )?quiz( on| for)?/i, '').trim() || 'your current topic'
    return {
      content: `### Quiz generator (backend not connected)

I can build **exam-oriented MCQs** for **${topic}** at Easy / Medium / Hard difficulty once the API is connected:

\`POST /api/v1/ai/quiz\`
\`\`\`json
{ "subjectId": "sub_math", "topicId": "tp_math_profit-and-loss_…", "difficulty": "medium", "count": 10 }
\`\`\`

The server prompt is grounded in the user's *actual* history — topics already mastered are down-weighted, and every generated question keeps \`origin: "ai-generated"\` so it is never labelled as an official previous-year question.

**Meanwhile**, these ready-made demo tests already work end-to-end:
${state.mockTests.slice(0, 3).map((m) => `• ${m.title} — ${m.questionIds.length} questions`).join('\n')}

_Rules-based demo output. No model was called._`,
      suggestions: ['Open Mock Tests', 'Show my weak topics', 'What should I revise today?']
    }
  }

  // default: personal study assistant
  const relevantTopic = allTopics(state).find(
    (t) => prompt.length > 4 && t.name.toLowerCase().includes(prompt.toLowerCase().slice(0, 18))
  )

  if (relevantTopic) {
    return {
      content: `### ${relevantTopic.name}

**Your record:** ${relevantTopic.revisions.length} revisions · ${relevantTopic.questionsAttempted} questions · confidence ${relevantTopic.confidence}/5 · mastery ${topicMastery(relevantTopic)}/100
**Last learnt:** ${relevantTopic.initialLearningDate ? formatShortDate(relevantTopic.initialLearningDate) : 'not started'}
**Next revision due:** ${relevantTopic.nextRevisionDue ? formatShortDate(relevantTopic.nextRevisionDue) : '—'}

**Key points on file**
${relevantTopic.keyPoints.length ? relevantTopic.keyPoints.map((p) => `• ${p}`).join('\n') : '• No notes saved yet — add them in Subjects → Topic.'}
${
  relevantTopic.formulas.length
    ? `\n**Formulas**\n${relevantTopic.formulas.map((f) => `• \`${f}\``).join('\n')}`
    : ''
}

Concept explanations and doubt-solving need the model endpoint. This panel reads only your own saved topic data.

_Rules-based demo output._`,
      suggestions: ['Explain my last mistake', 'What should I revise today?', 'Weekly report']
    }
  }

  return {
    content: `### Study assistant (demo mode)

I'm running on local rules, not a language model — there is no OpenAI key in the browser, by design. I can already read your real study data:

• **Today:** ${due.length} topic${due.length === 1 ? '' : 's'} due for revision
• **Streak:** ${streak.current} day${streak.current === 1 ? '' : 's'}
• **This week:** ${formatDuration(weekMinutes)} studied

Ask me things like *"What should I revise today?"*, *"Which chapters are weakest?"* or *"Weekly report"* — or connect the backend to unlock free-form doubt solving.

_Rules-based demo output._`,
    suggestions: ['What should I revise today?', 'Which chapters are weakest?', 'Weekly report']
  }
}

export function demoConversation(state: StudyState): AIMessage[] {
  const today = dateKey()
  const due = dueRevisions(state, today)
  return [
    {
      id: 'demo_msg_1',
      role: 'user',
      mode: 'assistant',
      content: 'What should I revise before my Mathematics session this evening?',
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      demo: true
    },
    {
      id: 'demo_msg_2',
      role: 'assistant',
      mode: 'assistant',
      content: `Before tonight's Mathematics session, prioritise these (all past their revision date):

${
  due
    .filter((d) => d.subject.id === 'sub_math')
    .slice(0, 3)
    .map((d, i) => `${i + 1}. **${d.topic.name}** — ${d.daysOverdue}d overdue, mastery ${topicMastery(d.topic)}/100`)
    .join('\n') || '1. Nothing overdue for Mathematics right now.'
}

Start with the topic that has the most logged mistakes, then run 10 questions to confirm.`,
      createdAt: new Date(Date.now() - 3_500_000).toISOString(),
      demo: true,
      suggestions: ['Show my weakest topics', 'Weekly report']
    }
  ]
}

export { round }
