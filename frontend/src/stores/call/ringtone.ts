/* ------------------ Гудки (WebAudio, без внешних файлов) ------------------ */

/** Мастер-громкость гудков (цепочка gain → компрессор → выход). */
/** Контекст WebAudio для гудков (создаётся на время гудка). */
let audioContext: AudioContext | null = null
/** Таймер повтора фразы гудка. */
let ringTimer: number | undefined
/** Возобновление контекста по первому жесту уже привязано. */
let unlockBound = false

let ringGain: GainNode | null = null

/**
 * Общая громкость рингтона. Ниже единицы намеренно: звонок звучит в тишине
 * (часто — в наушниках или ночью) и не должен пугать.
 */
const RING_LEVEL = 0.8
/** Плавное затухание при остановке: без него слышен щелчок обрыва. */
const RING_FADE_MS = 220
/** Пауза между повторами фразы: входящий — спокойный, исходящий — пореже. */
const RING_INCOMING_LOOP_MS = 5000
const RING_OUTGOING_LOOP_MS = 3200

/**
 * Цепочка вывода гудков: gain → компрессор → выход.
 *
 * Компрессор здесь вместо простого gain: он мягко придерживает пики
 * перекрывающихся нот. Без него сумма нот уходила за 1.0, браузер срезал
 * верхушки — звук становился дребезжащим и раздражающим.
 */
function ensureRingChain(ctx: AudioContext): GainNode {
  if (ringGain) return ringGain
  const gain = ctx.createGain()
  gain.gain.value = RING_LEVEL
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -18
  limiter.knee.value = 14
  limiter.ratio.value = 6
  limiter.attack.value = 0.01
  limiter.release.value = 0.35
  gain.connect(limiter)
  limiter.connect(ctx.destination)
  ringGain = gain
  return gain
}

export function stopRingtone() {
  if (ringTimer !== undefined) {
    window.clearTimeout(ringTimer)
    ringTimer = undefined
  }
  const ctx = audioContext
  const gain = ringGain
  audioContext = null
  ringGain = null
  if (!ctx) return
  /* Плавно уводим громкость в ноль и только потом закрываем контекст: резкий
     close() посреди ноты слышен как щелчок — он и делал гудок «резким». */
  try {
    if (gain) {
      const now = ctx.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + RING_FADE_MS / 1000)
    }
  } catch {
    /* контекст уже закрыт */
  }
  window.setTimeout(() => {
    void ctx.close().catch(() => undefined)
  }, RING_FADE_MS + 80)
}

type RingNote = { at: number; f: number; d: number; vol?: number }

/**
 * Входящий звонок: спокойная «стеклянная» фраза в ля-мажорной пентатонике.
 *
 * Прежний вариант был плотным маримбовым перезвоном из 12 нот с сильными
 * «бьющими» партиалами: на телефоне он звучал резко и успевал надоесть за
 * первый же гудок. Здесь ноты реже и тише, с длинными хвостами и мягкой опорой
 * в басу — слышно, но не раздражает.
 */
const INCOMING_RING: RingNote[] = [
  { at: 0.0, f: 220.0, d: 3.4, vol: 0.1 }, // A3 — тёплая опора
  { at: 0.0, f: 440.0, d: 2.6, vol: 0.14 }, // A4
  { at: 0.34, f: 739.99, d: 1.9, vol: 0.3 }, // F#5
  { at: 0.78, f: 880.0, d: 1.9, vol: 0.28 }, // A5
  { at: 1.22, f: 1108.73, d: 2.2, vol: 0.26 }, // C#6
  { at: 1.72, f: 880.0, d: 2.6, vol: 0.2 } // A5 — спокойное разрешение
]

/** Гудки ожидания для звонящего: редкие тихие ноты вместо частых «бипов». */
const OUTGOING_RING: RingNote[] = [
  { at: 0.0, f: 196.0, d: 1.6, vol: 0.12 }, // G3
  { at: 0.0, f: 392.0, d: 1.1, vol: 0.22 }, // G4
  { at: 0.5, f: 523.25, d: 1.1, vol: 0.18 } // C5
]

/**
 * Мягкая нота: чистый синус + очень тихая октава и слабый третий обертон.
 *
 * Никаких партиал ×4 и ×9.2 (как у маримбы): именно они давали металлический
 * призвук, от которого звонок быстро надоедал. Атака 12 мс убирает щелчок,
 * длинный экспоненциальный хвост — «стеклянный» шлейф.
 */
function softNote(freq: number, when: number, dur: number, volume: number) {
  if (!audioContext) return
  const ctx = audioContext
  const out = ringGain ?? ctx.destination
  const part = (ratio: number, rel: number, decay: number) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * ratio
    const peak = Math.max(0.0002, volume * rel)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur * decay)
    osc.connect(gain)
    gain.connect(out)
    osc.start(when)
    osc.stop(when + dur + 0.05)
  }
  part(1, 1, 1) // фундаментал
  part(2, 0.18, 0.7) // октава — звучит мягче и «дороже»
  part(3, 0.05, 0.45) // лёгкий блик на затухании
}

/** Играет фразу (ноты перекрываются) и повторяет её после паузы. */
function scheduleRing(notes: RingNote[], loopMs: number) {
  if (ringTimer !== undefined) {
    window.clearTimeout(ringTimer)
  }
  ringTimer = window.setTimeout(function tick() {
    const ctx = audioContext
    if (!ctx) return
    const base = ctx.currentTime + 0.06
    notes.forEach((n) => softNote(n.f, base + n.at, n.d, n.vol ?? 0.3))
    ringTimer = window.setTimeout(tick, loopMs)
  }, 150)
}

/**
 * Лёгкая вибрация при входящем звонке (Android, когда страница видима).
 * Два коротких толчка с длинной паузой: частые толчки бьют по нервам.
 */
function vibrateRing() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([160, 800, 160])
    }
  } catch {
    /* вибрация недоступна — не критично */
  }
}

/** Возобновляет аудио-контекст, если браузер приостановил его (автоплей). */
function resumeAudioIfSuspended() {
  if (audioContext && audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined)
  }
}

/**
 * Браузеры блокируют звук без «жеста» пользователя. Привязываем возобновление
 * контекста к первому же клику/тапу — тогда рингтон сработает даже для
 * входящего звонка (пришедшего без участия пользователя).
 */
function bindAudioUnlockOnce() {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  events.forEach((eventName) =>
    window.addEventListener(eventName, resumeAudioIfSuspended, { passive: true })
  )
}

bindAudioUnlockOnce()
export function startRingtone(kind: 'outgoing' | 'incoming') {
  stopRingtone()
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioContext = new Ctor()
    ensureRingChain(audioContext)
    bindAudioUnlockOnce()
    resumeAudioIfSuspended()
    // Входящий — мягкий «стеклянный» перезвон; исходящему — редкие тихие гудки.
    if (kind === 'outgoing') {
      scheduleRing(OUTGOING_RING, RING_OUTGOING_LOOP_MS)
    } else {
      scheduleRing(INCOMING_RING, RING_INCOMING_LOOP_MS)
      vibrateRing()
    }
  } catch {
    /* Аудио недоступно — звонок идёт без гудков */
  }
}
