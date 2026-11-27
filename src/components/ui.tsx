import { createPortal } from 'react-dom'
import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react'
import { cx } from '../lib/utils'

/* --------------------------------- Button -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'quiet'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  iconRight?: React.ReactNode
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  iconRight,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="spin" /> : icon}
      {children ? <span>{children}</span> : null}
      {iconRight}
    </button>
  )
}

/* ---------------------------------- Card --------------------------------- */

export function Card({
  className,
  children,
  as: Tag = 'section',
  pad = true,
  ...rest
}: {
  className?: string
  children: React.ReactNode
  as?: React.ElementType
  pad?: boolean
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx('card', pad && 'card--pad', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
  className
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cx('card-header', className)}>
      <div className="card-header__main">
        {icon ? <span className="card-header__icon">{icon}</span> : null}
        <div>
          <h2 className="card-header__title">{title}</h2>
          {subtitle ? <p className="card-header__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="card-header__actions">{actions}</div> : null}
    </header>
  )
}

/* --------------------------------- Badge --------------------------------- */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'purple'

export function Badge({
  tone = 'neutral',
  children,
  dot,
  size = 'md',
  className
}: {
  tone?: BadgeTone
  children: React.ReactNode
  dot?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span className={cx('badge', `badge--${tone}`, `badge--${size}`, className)}>
      {dot ? <span className="badge__dot" /> : null}
      {children}
    </span>
  )
}

/* -------------------------------- Progress ------------------------------- */

export function Progress({
  value,
  max = 100,
  tone = 'accent',
  height = 6,
  label,
  showValue,
  className
}: {
  value: number
  max?: number
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  height?: number
  label?: string
  showValue?: boolean
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))
  return (
    <div className={cx('progress', className)}>
      {label || showValue ? (
        <div className="progress__meta">
          {label ? <span>{label}</span> : <span />}
          {showValue ? <span className="mono">{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div
        className={cx('progress__track', `progress__track--${tone}`)}
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Ring({
  value,
  size = 64,
  stroke = 6,
  tone = 'var(--accent)',
  children
}: {
  value: number
  size?: number
  stroke?: number
  tone?: string
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .5s ease' }}
        />
      </svg>
      <div className="ring__label">{children}</div>
    </div>
  )
}

/* ---------------------------------- Form --------------------------------- */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cx('field', error && 'field--error', className)}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="field__req">*</span> : null}
      </label>
      {children}
      {error ? <p className="field__error">{error}</p> : hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  )
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} className={cx('input', className)} {...rest} />
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => <textarea ref={ref} className={cx('input', 'textarea', className)} {...rest} />
)
Textarea.displayName = 'Textarea'

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-wrap">
      <select className={cx('input', 'select', className)} {...rest}>
        {children}
      </select>
      <ChevronDown size={14} className="select-wrap__chevron" />
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className={cx('checkbox-row', disabled && 'is-disabled')}>
      <input
        id={id}
        type="checkbox"
        className="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="checkbox-row__label">
        <span>{label}</span>
        {description ? <span className="checkbox-row__desc">{description}</span> : null}
      </label>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className={cx('toggle-row', disabled && 'is-disabled')}>
      <div>
        <label htmlFor={id} className="toggle-row__label">
          {label}
        </label>
        {description ? <p className="toggle-row__desc">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={cx('toggle', checked && 'is-on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className
}: {
  options: Array<{ value: T; label: React.ReactNode; icon?: React.ReactNode }>
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className={cx('segmented', `segmented--${size}`, className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          className={cx('segmented__item', value === o.value && 'is-active')}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissible = true
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  dismissible?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, dismissible])

  if (!open) return null

  // Rendered into <body> so no parent stacking context (cards, timelines, sticky headers) can paint over it.
  return createPortal(
    <div className="modal-root" role="presentation">
      <div className="modal-backdrop" onClick={() => dismissible && onClose()} />
      <div className={cx('modal', `modal--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} ref={ref}>
        <header className="modal__header">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog" type="button">
            <X size={16} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  requireReason,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Add a short reason…'
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  requireReason?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])

  const submit = () => {
    if (requireReason && reason.trim().length < 3) {
      setError('Please give a reason of at least 3 characters.')
      return
    }
    onConfirm(reason.trim())
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-secondary" style={{ marginBottom: requireReason ? 16 : 0 }}>
        {message}
      </p>
      {requireReason ? (
        <Field label={reasonLabel} error={error} required>
          <Textarea rows={3} value={reason} placeholder={reasonPlaceholder} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}
    </Modal>
  )
}

/* --------------------------------- Toasts -------------------------------- */

export function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: Array<{ id: string; title: string; message?: string; variant: string }>
  onDismiss: (id: string) => void
}) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', `toast--${t.variant}`)} role="status">
          <span className="toast__icon">
            {t.variant === 'success' ? (
              <Check size={15} />
            ) : t.variant === 'error' ? (
              <XCircle size={15} />
            ) : t.variant === 'warning' ? (
              <AlertTriangle size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <div className="toast__body">
            <p className="toast__title">{t.title}</p>
            {t.message ? <p className="toast__msg">{t.message}</p> : null}
          </div>
          <button className="toast__close" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification" type="button">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  message,
  action,
  compact
}: {
  icon?: React.ReactNode
  title: string
  message?: string
  action?: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={cx('empty', compact && 'empty--compact')}>
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <p className="empty__title">{title}</p>
      {message ? <p className="empty__msg">{message}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  )
}

/* -------------------------------- Skeleton ------------------------------- */

export function Skeleton({ width, height = 14, radius = 6, className }: { width?: number | string; height?: number; radius?: number; className?: string }) {
  return <div className={cx('skeleton', className)} style={{ width: width ?? '100%', height, borderRadius: radius }} />
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <Loader2 size={18} className="spin" />
      <span>{label}</span>
    </div>
  )
}

/* ---------------------------------- Stat --------------------------------- */

export function StatCard({
  label,
  value,
  unit,
  icon,
  tone = 'neutral',
  hint,
  footer,
  onClick
}: {
  label: string
  value: React.ReactNode
  unit?: string
  icon?: React.ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  hint?: React.ReactNode
  footer?: React.ReactNode
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={cx('stat', `stat--${tone}`, onClick && 'stat--clickable')} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="stat__top">
        <span className="stat__label">{label}</span>
        {icon ? <span className="stat__icon">{icon}</span> : null}
      </div>
      <div className="stat__value mono">
        {value}
        {unit ? <span className="stat__unit">{unit}</span> : null}
      </div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
      {footer}
    </Tag>
  )
}

/* --------------------------------- Tabs ---------------------------------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className
}: {
  tabs: Array<{ value: T; label: string; count?: number }>
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cx('tabs', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={cx('tabs__item', value === t.value && 'is-active')}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {typeof t.count === 'number' ? <span className="tabs__count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------- Avatar ---------------------------------- */

export function Avatar({ name, size = 32, src }: { name: string; size?: number; src?: string }) {
  const text = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {src ? <img src={src} alt={name} /> : text}
    </span>
  )
}

/* ------------------------------ Scoped toast ----------------------------- */

const ToastCtx = createContext<((t: { title: string; message?: string; variant?: string }) => void) | null>(null)
export const ToastContext = ToastCtx
export function useToast() {
  const ctx = useContext(ToastCtx)
  return ctx ?? (() => undefined)
}

export { useState }
