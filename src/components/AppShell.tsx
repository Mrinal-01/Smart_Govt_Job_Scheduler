import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Brain,
  CalendarDays,
  ChevronLeft,
  CloudOff,
  CloudUpload,
  Cloud,
  LogOut,
  ShieldCheck,
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
  Sun,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudy } from '../store/StudyStore'
import { useAuth } from '../auth/AuthContext'
import { useWorkspaceSync } from '../workspace/WorkspaceGate'
import { dueRevisions, logsInRange, streakFor } from '../store/selectors'
import { formatLongDate, formatDuration, dateKey, addDays, nowTimeLabel, greeting, weekdayOf } from '../lib/date'
import { cx, pct } from '../lib/utils'
import { Avatar, Button, Progress } from './ui'
import { formatPhone } from '../lib/phone'

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
    { to: '/schedule', label: 'My Schedule', icon: <CalendarDays size={16} />, group: 'main' },
    { to: '/revision', label: 'Revision Center', icon: <RotateCcw size={16} />, badge: due.length, group: 'main' },
    { to: '/subjects', label: 'Subjects & Chapters', icon: <GraduationCap size={16} />, group: 'study' },
    { to: '/tests', label: 'Tests', icon: <ClipboardList size={16} />, group: 'study' },
    { to: '/mistakes', label: 'Mistake Bank', icon: <CircleHelp size={16} />, badge: state.mistakes.filter((m) => m.status === 'unresolved').length, group: 'study' },
    { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={16} />, group: 'study' },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon size={16} />, group: 'study' }
  ]

  const groups = [
    { key: 'main', label: 'Today' },
    { key: 'study', label: 'Study' }
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

function SyncIndicator() {
  const { status } = useWorkspaceSync()
  const meta = {
    saved: { icon: <Cloud size={14} />, label: 'Saved', cls: 'is-ok' },
    saving: { icon: <CloudUpload size={14} />, label: 'Saving…', cls: 'is-busy' },
    offline: { icon: <CloudOff size={14} />, label: 'Offline — kept on this device', cls: 'is-warn' },
    error: { icon: <CloudOff size={14} />, label: 'Sync error — retrying', cls: 'is-warn' },
    conflict: { icon: <CloudOff size={14} />, label: 'Changed elsewhere — reload', cls: 'is-bad' }
  }[status]
  return (
    <span className={cx('sync-pill', meta.cls)} title={`Sync status: ${meta.label}`} role="status">
      {meta.icon}
      <span className="desktop-label">{meta.label}</span>
    </span>
  )
}

function AccountMenu() {
  const { state } = useStudy()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const name = user?.name ?? state.profile.name
  return (
    <div className="account-menu" ref={ref}>
      <button className="profile-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Open account menu">
        <Avatar name={name} size={28} />
        <span className="profile-btn__meta">
          <span className="profile-btn__name">{name.split(' ')[0]}</span>
          <span className="profile-btn__role">{state.settings.examTarget}</span>
        </span>
      </button>
      {open ? (
        <div className="account-menu__panel" role="menu">
          <div className="account-menu__who">
            <strong>{name}</strong>
            <span className="text-tertiary">{user?.phone ? formatPhone(user.phone) : user?.email}</span>
          </div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/settings?section=account') }}>
            <SettingsIcon size={14} /> Account settings
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/settings?section=security') }}>
            <ShieldCheck size={14} /> Security & sessions
          </button>
          <button role="menuitem" className="is-danger" onClick={() => void logout()}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
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
          <span className="header__date-main">
            {/* "Friday, 27 Nov 2026" on desktop; "27 Nov" on phones */}
            <span className="long-only">{formatLongDate(today).split(', ')[0]}, </span>
            {formatLongDate(today).split(', ').slice(1).join(', ').replace(/ \d{4}$/, '')}
            <span className="long-only">{formatLongDate(today).match(/ \d{4}$/)?.[0] ?? ''}</span>
          </span>
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
        <SyncIndicator />
        <AccountMenu />
      </div>
    </header>
  )
}

export { dateKey, weekdayOf, greeting, ChevronLeft, ChevronRight }
