import type { SoundChoice } from '../types'
import { apiBlob } from '../lib/http'

/**
 * Web Audio reminder engine.
 *
 * Why Web Audio instead of an <audio> file: no network request, no asset
 * licensing, and the loop can be stopped instantly (requirement: "the sound
 * must stop immediately when the user completes the session").
 *
 * IMPORTANT LIMITATION (surfaced in the UI): this only runs while the tab is
 * alive. Background/closed-tab delivery would need Web Push + a service worker
 * + a server-side scheduler (not implemented).
 */

type Ctx = AudioContext | null

const isCustom = (s: SoundChoice): s is `custom:${string}` => s.startsWith('custom:')
const PATTERN_MS: Record<string, number> = { pulse: 4200, gong: 4500, alarm: 2400 }

class ReminderAudio {
  private ctx: Ctx = null
  /** Element playing a student-uploaded sound (custom:<id>). */
  private audioEl: HTMLAudioElement | null = null
  private blobUrls = new Map<string, string>()
  private loopTimer: number | null = null
  private activeNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = []
  private playing = false
  private sound: SoundChoice = 'chime'
  private volume = 0.55
  /** A start() requested before the first user gesture; honoured by unlock(). */
  private pendingStart: { sound: SoundChoice; volume: number } | null = null

  /**
   * Browsers block audio until the user interacts with the page. Creating or
   * resuming an AudioContext earlier only produces console warnings, so wait.
   */
  private get gestureSeen(): boolean {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    return ua ? ua.hasBeenActive : true
  }

  private ensureCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx && !this.gestureSeen) return null
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!this.ctx) this.ctx = new AC()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Browsers require a user gesture before audio can start. */
  async unlock(): Promise<void> {
    const ctx = this.ensureCtx()
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        /* ignored */
      }
    }
    if (this.pendingStart) {
      const { sound, volume } = this.pendingStart
      this.pendingStart = null
      this.start(sound, volume)
    }
  }

  setConfig(sound: SoundChoice, volume: number) {
    this.sound = sound
    this.volume = Math.max(0, Math.min(1, volume))
  }

  /** One-shot preview used by Settings. */
  playOnce(sound: SoundChoice = this.sound, volume = this.volume): void {
    if (sound === 'none') return
    if (isCustom(sound)) {
      if (this.gestureSeen) void this.playCustom(sound.slice(7), volume, false)
      return
    }
    const ctx = this.ensureCtx()
    if (!ctx) return
    this.schedulePattern(ctx, sound, volume, 0)
  }

  /** Downloads (once) an uploaded sound and keeps it as an in-memory URL. */
  private async loadCustom(id: string): Promise<string> {
    const cached = this.blobUrls.get(id)
    if (cached) return cached
    const url = URL.createObjectURL(await apiBlob(`/api/sounds/${id}/file`))
    this.blobUrls.set(id, url)
    return url
  }

  /** Call after deleting an uploaded sound. */
  forgetCustom(id: string) {
    const url = this.blobUrls.get(id)
    if (url) URL.revokeObjectURL(url)
    this.blobUrls.delete(id)
  }

  private async playCustom(id: string, volume: number, loop: boolean) {
    try {
      const url = await this.loadCustom(id)
      if (loop && !this.playing) return // stopped while downloading
      this.audioEl?.pause()
      const el = new Audio(url)
      el.loop = loop
      el.volume = Math.max(0, Math.min(1, volume))
      this.audioEl = el
      await el.play()
    } catch {
      // Missing/deleted/unplayable file: never stay silent — fall back to the default chime.
      if (loop && this.playing) {
        this.playing = false
        this.start('chime', volume)
      } else if (!loop) {
        this.playOnce('chime', volume)
      }
    }
  }

  start(sound: SoundChoice = this.sound, volume = this.volume): void {
    if (this.playing || sound === 'none') return
    if (isCustom(sound)) {
      if (!this.gestureSeen) {
        this.pendingStart = { sound, volume }
        return
      }
      this.playing = true
      this.sound = sound
      this.volume = volume
      void this.playCustom(sound.slice(7), volume, true)
      return
    }
    const ctx = this.ensureCtx()
    if (!ctx) {
      this.pendingStart = { sound, volume }
      return
    }
    this.playing = true
    this.sound = sound
    this.volume = volume

    const cycle = () => {
      if (!this.playing) return
      this.schedulePattern(ctx, sound, volume, 0)
      const patternLength = PATTERN_MS[sound] ?? 2600
      this.loopTimer = window.setTimeout(cycle, patternLength)
    }
    cycle()
  }

  stop(): void {
    this.pendingStart = null
    this.playing = false
    if (this.audioEl) {
      this.audioEl.pause()
      this.audioEl = null
    }
    if (this.loopTimer !== null) {
      window.clearTimeout(this.loopTimer)
      this.loopTimer = null
    }
    this.activeNodes.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(this.ctx?.currentTime ?? 0)
        gain.gain.setValueAtTime(0.0001, this.ctx?.currentTime ?? 0)
        osc.stop()
      } catch {
        /* node already stopped */
      }
    })
    this.activeNodes = []
  }

  get isPlaying(): boolean {
    return this.playing
  }

  private schedulePattern(ctx: AudioContext, sound: SoundChoice, volume: number, offset: number): void {
    const now = ctx.currentTime + offset
    const master = ctx.createGain()
    master.gain.value = volume * 0.5
    master.connect(ctx.destination)

    const blip = (freq: number, at: number, dur: number, type: OscillatorType = 'sine', peak = 0.6) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, now + at)
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur)
      osc.connect(gain)
      gain.connect(master)
      osc.start(now + at)
      osc.stop(now + at + dur + 0.05)
      this.activeNodes.push({ osc, gain })
      osc.onended = () => {
        this.activeNodes = this.activeNodes.filter((n) => n.osc !== osc)
      }
    }

    if (sound === 'chime') {
      blip(880, 0, 0.5)
      blip(1174.7, 0.16, 0.55)
      blip(1318.5, 0.32, 0.7)
    } else if (sound === 'bell') {
      for (let i = 0; i < 3; i += 1) {
        blip(1046.5, i * 0.55, 0.6, 'triangle', 0.5)
        blip(1568, i * 0.55 + 0.01, 0.45, 'sine', 0.25)
      }
    } else if (sound === 'digital') {
      // two bursts of short square beeps, like a digital watch
      for (let burst = 0; burst < 2; burst += 1) {
        for (let i = 0; i < 4; i += 1) blip(1500, burst * 0.9 + i * 0.12, 0.08, 'square', 0.25)
      }
    } else if (sound === 'marimba') {
      // rising C-major arpeggio with a soft wooden decay
      ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => blip(f, i * 0.15, 0.35, 'sine', 0.55))
    } else if (sound === 'gong') {
      // one deep, long resonance
      blip(196, 0, 2.4, 'sine', 0.6)
      blip(293.7, 0.02, 1.4, 'triangle', 0.25)
      blip(392, 0.04, 0.8, 'sine', 0.15)
    } else if (sound === 'alarm') {
      // urgent two-tone alternation
      for (let i = 0; i < 6; i += 1) blip(i % 2 ? 660 : 880, i * 0.22, 0.2, 'square', 0.3)
    } else if (sound === 'ping') {
      // gentle double ping
      blip(1760, 0, 0.25, 'sine', 0.35)
      blip(2349.3, 0.12, 0.3, 'sine', 0.25)
    } else {
      // 'pulse' — two low urgency thumps repeated
      for (let i = 0; i < 3; i += 1) {
        blip(330, i * 1.1, 0.28, 'sawtooth', 0.35)
        blip(220, i * 1.1 + 0.3, 0.34, 'sine', 0.4)
      }
    }
  }
}

export const reminderAudio = new ReminderAudio()

/* ------------------------------ notifications ----------------------------- */

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function sendBrowserNotification(title: string, body: string, tag?: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      body,
      tag,
      icon:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%234f46e5'/%3E%3C/svg%3E"
    })
  } catch {
    /* some browsers block programmatic notifications outside SW */
  }
}

export function notifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}
