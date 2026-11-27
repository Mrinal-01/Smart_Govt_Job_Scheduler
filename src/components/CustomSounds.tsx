import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Trash2, Upload } from 'lucide-react'
import type { SoundChoice } from '../types'
import { Badge, Button } from './ui'
import { api, errorMessage, uploadWithProgress } from '../lib/http'
import { reminderAudio } from '../services/audio'

export interface CustomSound {
  id: string
  name: string
  format: string
  sizeBytes: number
}

const ACCEPT = '.mp3,.wav,.ogg,.m4a,.webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm'
const MAX_SECONDS = 30

/** The student's uploaded reminder sounds (server-stored, max 10). */
export function useCustomSounds() {
  const [sounds, setSounds] = useState<CustomSound[]>([])
  const [limit, setLimit] = useState(10)
  const [maxBytes, setMaxBytes] = useState(2 * 1024 * 1024)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      const r = await api<{ sounds: CustomSound[]; limit: number; maxBytes: number }>('/api/sounds')
      setSounds(r.sounds)
      setLimit(r.limit)
      setMaxBytes(r.maxBytes)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { sounds, limit, maxBytes, error, reload }
}

/** Reads the clip length in the browser so over-long files are rejected before uploading. */
function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const el = new Audio()
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(el.duration)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This file cannot be played by your browser.'))
    }
    el.src = url
  })
}

export function CustomSoundsManager({
  data,
  selected,
  volume,
  onSelect
}: {
  data: ReturnType<typeof useCustomSounds>
  selected: SoundChoice
  volume: number
  onSelect: (sound: SoundChoice) => void
}) {
  const { sounds, limit, maxBytes, error: loadError, reload } = data
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const full = sounds.length >= limit

  const upload = async (file: File) => {
    setError('')
    if (full) return setError(`You already have ${limit} sounds. Delete one first.`)
    if (!/\.(mp3|wav|ogg|m4a|webm)$/i.test(file.name)) return setError('Choose an MP3, WAV, OGG, M4A or WebM file.')
    if (file.size > maxBytes) return setError(`The file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${maxBytes / 1048576} MB.`)
    try {
      const seconds = await audioDuration(file)
      if (!Number.isFinite(seconds) || seconds <= 0) return setError('This file has no playable audio.')
      if (seconds > MAX_SECONDS) return setError(`Keep alert sounds to ${MAX_SECONDS} seconds or less (this one is ${Math.round(seconds)} s).`)
    } catch (err) {
      return setError(errorMessage(err))
    }
    const form = new FormData()
    form.append('name', file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'My sound')
    form.append('file', file)
    setProgress(0)
    try {
      const r = await uploadWithProgress<{ sound: CustomSound }>('/api/sounds', form, setProgress).promise
      await reload()
      onSelect(`custom:${r.sound.id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async (s: CustomSound) => {
    setError('')
    try {
      await api(`/api/sounds/${s.id}`, { method: 'DELETE' })
      reminderAudio.forgetCustom(s.id)
      if (selected === `custom:${s.id}`) onSelect('chime')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="custom-sounds">
      <div className="row row--between row--wrap" style={{ gap: 8 }}>
        <span className="settings-row__label">
          Your sounds{' '}
          <Badge size="sm" tone={full ? 'warning' : 'neutral'}>
            {sounds.length}/{limit}
          </Badge>
        </span>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button size="sm" variant="secondary" icon={<Upload size={13} />} disabled={full || progress !== null} loading={progress !== null} onClick={() => input.current?.click()}>
          {progress !== null ? `Uploading ${progress}%` : 'Upload sound'}
        </Button>
      </div>
      <p className="settings-row__hint">MP3, WAV, OGG, M4A or WebM · up to {maxBytes / 1048576} MB and {MAX_SECONDS} seconds · max {limit} sounds.</p>
      {error || loadError ? <div className="callout callout--danger" style={{ marginTop: 6 }}>{error || loadError}</div> : null}
      {sounds.length ? (
        <ul className="custom-sounds__list">
          {sounds.map((s) => {
            const value: SoundChoice = `custom:${s.id}`
            return (
              <li key={s.id} className={selected === value ? 'is-selected' : undefined}>
                <span className="truncate" style={{ flex: 1, minWidth: 0 }}>
                  {s.name} <span className="text-tertiary">· {s.format.toUpperCase()} · {Math.max(1, Math.round(s.sizeBytes / 1024))} KB</span>
                </span>
                <Button size="icon" variant="ghost" aria-label={`Play ${s.name}`} onClick={() => reminderAudio.playOnce(value, volume)}>
                  <Play size={13} />
                </Button>
                {selected === value ? (
                  <Badge size="sm" tone="accent">
                    in use
                  </Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => onSelect(value)}>
                    Use
                  </Button>
                )}
                <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}>
                  <Trash2 size={13} />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
