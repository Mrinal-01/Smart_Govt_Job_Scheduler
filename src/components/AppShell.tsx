import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Brain,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Flame,
  GraduationCap,
  LayoutDashboard,
  Menu,
  Moon,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Timer,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStudy } from '../store/StudyStore'
import { dueRevisions, logsInRange, streakFor } from '../store/selectors'
import { formatLongDate, formatDuration, dateKey, addDays, nowTimeLabel, greeting, weekdayOf } from '../lib/date'
import { cx, pct } from '../lib/utils'
import { Avatar, Button, Progress } from './ui'

export interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  badge?: number
  group: 'main' | 'study' | 'insight'
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, today } = useStudy()
  const location = useLocation()
  const due = useMemo(() => dueRevisions(state, today), [state, today])
  const streak = useMemo(() => streakFor(state, today), [state, today])
  const weekMinutes = useMemo(() => {
    const logs = logsInRange(state, addDays(today, -6), today)
    return logs.reduce((acc, l) => acc + l.actualMinutes, 0)
  }, [state, today])
  const target = state.settings.weeklyTargetMinutes

  const items: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={16} />, group: 'main' },
    { to: '/sunday', label: 'Sunday Review', icon: <BookOpenCheck size={16} />, group: 'main' },
    { to: '/schedule', label: 'My Schedule', icon: <CalendarDays size={16} />, group: 'study' },
    { to: '/sessions', label: 'Study Sessions', icon: <Timer size={16} />, group: 'study' },
    { to: '/subjects', label: 'Subjects & Chapters', icon: <GraduationCap size={16} />, group: 'study' },
    { to: '/revision', label: 'Revision Center', icon: <RotateCcw size={16} />, badge: due.length, group: 'study' },
    { to: '/mock-tests', label: 'Mock Tests', icon: <ClipboardList size={16} />, group: 'study' },
    { to: '/mistakes', label: 'Mistake Bank', icon: <CircleHelp size={16} />, badge: state.mistakes.filter((m) => m.status === 'unresolved').length, group: 'study' },
    { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={16} />, group: 'insight' },
    { to: '/assistant', label: 'AI Study Assistant', icon: <Sparkles size={16} />, group: 'insight' },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon size={16} />, group: 'insight' }
  ]

  const groups = [
    { key: 'main', label: 'Overview' },
    { key: 'study', label: 'Study' },
    { key: 'insight', label: 'Insights' }
  ] as const

  return (
    <aside className={cx('sidebar', open && 'is-open')} aria-label="Primary navigation">
      <div className="sidebar__brand">
        <span className="brand-mark">
          <Brain size={17} />
        </span>
        <div className="brand-text">
          <span className="brand-name">StudyOS</span>
          <span className="brand-tag">Study OS · India</span>
        </div>
        <button className="icon-btn is-ghost mobile-only" onClick={onClose} style={{ marginLeft: 'auto' }} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <nav className="sidebar__scroll">
        {groups.map((g) => {
          const groupItems = items.filter((i) => i.group === g.key)
          if (!groupItems.length) return null
          return (
            <div className="nav-group" key={g.key}>
              <p className="nav-group__label">{g.label}</p>
              {groupItems.map((item) => {
                const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={cx('nav-item', active && 'is-active')}
                    onClick={onClose}
                    title={item.label}
                  >
                    <span className="nav-item__icon">{item.icon}</span>
                    <span className="nav-item__label">{item.label}</span>
                    {item.badge ? <span className="nav-item__count">{item.badge}</span> : null}
                  </NavLink>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar-card">
          <div className="sidebar-card__row">
            <span>Weekly target</span>
            <strong className="mono">{formatDuration(weekMinutes)}</strong>
          </div>
          <Progress value={weekMinutes} max={target} tone={weekMinutes >= target ? 'success' : 'accent'} height={5} />
          <div className="sidebar-card__foot">
            <span>{pct(weekMinutes, target)}% of {formatDuration(target)}</span>
            <span className="row" style={{ gap: 3 }}>
              <Flame size={11} /> {streak.current}d
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { state, today, updateSettings } = useStudy()
  const navigate = useNavigate()
  const [now, setNow] = useState(() => nowTimeLabel())

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowTimeLabel()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const todayLog = state.logs.find((l) => l.date === today)
  const planned = todayLog?.plannedMinutes ?? 0
  const actual = todayLog?.actualMinutes ?? 0
  const percent = Math.min(100, Math.round((actual / Math.max(1, planned)) * 100))
  const unresolvedMistakes = state.mistakes.filter((m) => m.status === 'unresolved').length

  const toggleTheme = () => {
    updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' })
  }

  return (
    <header className="header">
      <button className="icon-btn mobile-only" onClick={onOpenMenu} aria-label="Open menu">
        <Menu size={17} />
      </button>

      <div className="header__left">
        <div className="header__date">
          <span className="header__date-main">{formatLongDate(today)}</span>
          <span className="header__date-sub">
            {state.settings.timezone} · {now}
          </span>
        </div>
      </div>

      <div className="header__spacer" />

      <div className="header__progress" title="Today's study progress">
        <span>Today</span>
        <div style={{ width: 72 }}>
          <Progress value={percent} tone={percent >= 100 ? 'success' : 'accent'} height={5} />
        </div>
        <b className="mono">{percent}%</b>
        <span className="text-tertiary">·</span>
        <span className="mono">
          {formatDuration(actual)} / {formatDuration(planned)}
        </span>
      </div>

      <div className="header__actions">
        <button
          className="icon-btn"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={state.settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {state.settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-btn" onClick={() => navigate('/revision')} aria-label="Notifications" title="Revision reminders">
          <Bell size={16} />
          {unresolvedMistakes > 0 || percent < 60 ? <span className="icon-btn__dot" /> : null}
        </button>
        <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => navigate('/schedule?add=1')}>
          <span className="desktop-label">New session</span>
        </Button>
        <button className="profile-btn" onClick={() => navigate('/settings')} aria-label="Open profile settings">
          <Avatar name={state.profile.name} size={28} />
          <span className="profile-btn__meta">
            <span className="profile-btn__name">{state.profile.name.split(' ')[0]}</span>
            <span className="profile-btn__role">{state.settings.examTarget}</span>
          </span>
        </button>
      </div>
    </header>
  )
}

export { dateKey, weekdayOf, greeting, ChevronLeft, ChevronRight }
