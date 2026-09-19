/* ------------------ Гудки (WebAudio, без внешних файлов) ------------------ */

/**
 * Мелодия синтезируется на месте: в PWA звуковой файл — лишний риск (его надо
 * успеть скачать и не промахнуться с кэшем), а звонок это критический путь.
 *
 * Фраза собрана из НЕСКОЛЬКИХ «инструментов»: мягкий колокольчик ведёт мелодию,
 * маримба-пиццикато играет арпеджио, тёплая подкладка держит гармонию, низ даёт
 * опору, а высокий «блик» уходит в эхо и добавляет объём. Одним голосом (как
 * было раньше) звонок звучал бедно.
 */

/** Контекст WebAudio для гудков (создаётся на время гудка). */
let audioContext: AudioContext | null = null
/** Таймер повтора фразы гудка. */
let ringTimer: number | undefined
/** Возобновление контекста по первому жесту уже привязано. */
let unlockBound = false

let ringGain: GainNode | null = null
/** Шина эха: голоса шлют туда «блик», оттуда — в общий выход. */
let ringEcho: GainNode | null = null

/**
 * Общая громкость рингтона. Ниже единицы намеренно: звонок звучит в тишине
 * (часто — в наушниках или ночью) и не должен пугать.
 */
const RING_LEVEL = 0.8
/** Плавное затухание при остановке: без него слышен щелчок обрыва. */
const RING_FADE_MS = 220
/** Атака ноты: 12 мс убирают щелчок, но не «смазывают» начало. */
const RING_ATTACK_S = 0.012
/** Пауза между повторами фразы: входящий — спокойный, исходящий — пореже. */
export const RING_INCOMING_LOOP_MS = 7200
export const RING_OUTGOING_LOOP_MS = 4400

/**
 * «Инструменты» рингтона: голоса с разным тембром и атакой.
 *
 * Список экспортируется, чтобы тест мог проверить, что фраза действительно
 * многоголосная (один инструмент на всё — это и был прежний звук).
 */
export type RingVoice = 'bell' | 'pluck' | 'pad' | 'bass' | 'shimmer'

export const RING_VOICES: RingVoice[] = ['bell', 'pluck', 'pad', 'bass', 'shimmer']

/**
 * Цепочка вывода гудков: gain → компрессор → выход плюс шина эха.
 *
 * Компрессор здесь вместо простого gain: он мягко придерживает пики
 * перекрывающихся нот. Без него сумма пяти голосов уходила за 1.0, браузер
 * срезал верхушки — звук становился дребезжащим и раздражающим.
 *
 * Эхо — короткая задержка с затуханием и фильтром: в него уходят только
 * высокие «блики» (`shimmer`), иначе гармония превратилась бы в кашу.
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

  const send = ctx.createGain()
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.27
  const feedback = ctx.createGain()
  feedback.gain.value = 0.24
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 2400
  const wet = ctx.createGain()
  wet.gain.value = 0.5
  send.connect(delay)
  delay.connect(damp)
  damp.connect(feedback)
  feedback.connect(delay)
  damp.connect(wet)
  wet.connect(gain)

  ringGain = gain
  ringEcho = send
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
  ringEcho = null
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

/** Нота фразы: когда играть (с), высота (Гц), длительность (с), громкость, панорама. */
type RingNote = { at: number; f: number; d: number; vol?: number; pan?: number }
/** Партия одного инструмента: голос и его ноты. */
type RingPart = { voice: RingVoice; notes: RingNote[] }
/** Фраза: партии и пауза до повтора. */
type RingTune = { loopMs: number; parts: RingPart[] }

/** Куда подключать ноту: с панорамой, если браузер это умеет. */
function noteOut(ctx: AudioContext, pan: number): AudioNode {
  const master = ringGain ?? ctx.destination
  if (!pan || typeof ctx.createStereoPanner !== 'function') return master
  const panner = ctx.createStereoPanner()
  panner.pan.value = Math.max(-1, Math.min(1, pan))
  panner.connect(master)
  return panner
}

/**
 * Один тон с атакой и экспоненциальным затуханием.
 *
 * Затухание именно экспоненциальное: так гаснет живой инструмент, а линейный
 * спад слышен как «выключение звука».
 */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  freq: number,
  when: number,
  dur: number,
  vol: number,
  options: {
    type?: OscillatorType
    attack?: number
    decay?: number
    detune?: number
  } = {}
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = options.type ?? 'sine'
  osc.frequency.value = freq
  if (options.detune) osc.detune.value = options.detune
  const peak = Math.max(0.0002, vol)
  const attack = options.attack ?? RING_ATTACK_S
  const tail = Math.max(0.06, dur * (options.decay ?? 1))
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(peak, when + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + tail)
  osc.connect(gain)
  gain.connect(out)
  osc.start(when)
  osc.stop(when + attack + tail + 0.05)
}

/** Фильтрованный выход для голосов с «мягким» тембром. */
function filteredOut(ctx: AudioContext, out: AudioNode, cutoff: number): AudioNode {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  filter.connect(out)
  return filter
}

/** Играет одну ноту выбранным инструментом. */
function playNote(voice: RingVoice, note: RingNote, when: number) {
  const ctx = audioContext
  if (!ctx || !ringGain) return
  const out = noteOut(ctx, note.pan ?? 0)
  const vol = note.vol ?? 0.22
  switch (voice) {
    case 'bell':
      // Колокольчик: чистый тон и два «не в строю» партиала (×2.76 и ×5.4).
      // Именно они дают объём, поэтому уровни партиалов очень низкие — иначе
      // появляется металлический призвук, от которого звонок быстро надоедает.
      tone(ctx, out, note.f, when, note.d, vol)
      tone(ctx, out, note.f * 2.76, when, note.d, vol * 0.2, { decay: 0.55 })
      tone(ctx, out, note.f * 5.4, when, note.d, vol * 0.06, { decay: 0.35 })
      break
    case 'pluck': {
      // Маримба-пиццикато: треугольник с коротким хвостом плюс тихая пила
      // через фильтр — без неё нота звучала бы «пустой».
      const filtered = filteredOut(ctx, out, Math.min(2600, note.f * 6))
      tone(ctx, filtered, note.f, when, note.d, vol, { type: 'triangle', decay: 0.45 })
      tone(ctx, filtered, note.f * 2, when, note.d, vol * 0.3, {
        type: 'sawtooth',
        decay: 0.25
      })
      break
    }
    case 'pad': {
      // Тёплая подкладка: два расстроенных треугольника (биения дают «живое»
      // звучание) через низкий фильтр и с медленной атакой.
      const filtered = filteredOut(ctx, out, 1400)
      tone(ctx, filtered, note.f, when, note.d, vol, { type: 'triangle', attack: 0.32 })
      tone(ctx, filtered, note.f, when, note.d, vol * 0.7, {
        type: 'triangle',
        attack: 0.32,
        detune: 7
      })
      break
    }
    case 'bass':
      // Низ: синус со слабой октавой и мягкой атакой — опора без гула.
      tone(ctx, out, note.f, when, note.d, vol, { attack: 0.05, decay: 0.95 })
      tone(ctx, out, note.f * 2, when, note.d, vol * 0.18, { attack: 0.05, decay: 0.8 })
      break
    case 'shimmer':
      // Высокий «блик»: тихо напрямую и чуть громче в эхо — объём без звона.
      tone(ctx, out, note.f, when, note.d, vol * 0.5, { attack: 0.08, decay: 0.9 })
      if (ringEcho) {
        tone(ctx, ringEcho, note.f, when, note.d, vol * 0.4, { attack: 0.08, decay: 0.9 })
      }
      break
  }
}

/**
 * Входящий звонок: три такта по 2.4 с (A → D → F#m), повтор 7.2 с.
 *
 * Гармония — ля мажорная пентатоника: в ней нет полутонов, поэтому случайно
 * совпавшие ноты не звучат «фальшиво» (это важно для синтеза, где всё статично).
 * Мелодию ведёт колокольчик длинными нотами — её и узнают при следующем звонке.
 */
const INCOMING_TUNE: RingTune = {
  loopMs: RING_INCOMING_LOOP_MS,
  parts: [
    {
      voice: 'pad',
      notes: [
        { at: 0.0, f: 220.0, d: 2.8, vol: 0.1 },
        { at: 0.0, f: 277.18, d: 2.8, vol: 0.07 },
        { at: 0.0, f: 329.63, d: 2.8, vol: 0.06 },
        { at: 2.4, f: 146.83, d: 2.8, vol: 0.1 },
        { at: 2.4, f: 185.0, d: 2.8, vol: 0.07 },
        { at: 2.4, f: 220.0, d: 2.8, vol: 0.06 },
        { at: 4.8, f: 185.0, d: 2.8, vol: 0.1 },
        { at: 4.8, f: 220.0, d: 2.8, vol: 0.07 },
        { at: 4.8, f: 277.18, d: 2.8, vol: 0.06 }
      ]
    },
    {
      voice: 'bass',
      notes: [
        { at: 0.0, f: 110.0, d: 2.2, vol: 0.16 },
        { at: 2.4, f: 146.83, d: 2.2, vol: 0.15 },
        { at: 4.8, f: 92.5, d: 2.2, vol: 0.16 }
      ]
    },
    {
      // Арпеджио разведено по панораме: так слышен инструмент, а не сплошной аккорд.
      voice: 'pluck',
      notes: [
        { at: 0.05, f: 440.0, d: 1.1, vol: 0.1, pan: -0.35 },
        { at: 0.35, f: 554.37, d: 1.1, vol: 0.09, pan: 0.2 },
        { at: 0.65, f: 659.25, d: 1.1, vol: 0.08, pan: -0.15 },
        { at: 0.95, f: 880.0, d: 1.1, vol: 0.07, pan: 0.35 },
        { at: 2.45, f: 369.99, d: 1.1, vol: 0.1, pan: -0.35 },
        { at: 2.75, f: 440.0, d: 1.1, vol: 0.09, pan: 0.2 },
        { at: 3.05, f: 587.33, d: 1.1, vol: 0.08, pan: -0.15 },
        { at: 3.35, f: 739.99, d: 1.1, vol: 0.07, pan: 0.35 },
        { at: 4.85, f: 369.99, d: 1.1, vol: 0.1, pan: -0.35 },
        { at: 5.15, f: 440.0, d: 1.1, vol: 0.09, pan: 0.2 },
        { at: 5.45, f: 554.37, d: 1.1, vol: 0.08, pan: -0.15 },
        { at: 5.75, f: 659.25, d: 1.1, vol: 0.07, pan: 0.35 }
      ]
    },
    {
      voice: 'bell',
      notes: [
        { at: 0.15, f: 659.25, d: 2.0, vol: 0.26 },
        { at: 1.15, f: 554.37, d: 1.2, vol: 0.2 },
        { at: 2.55, f: 587.33, d: 1.6, vol: 0.26 },
        { at: 3.35, f: 739.99, d: 1.2, vol: 0.2 },
        { at: 4.95, f: 659.25, d: 1.4, vol: 0.24 },
        { at: 5.75, f: 554.37, d: 1.3, vol: 0.2 }
      ]
    },
    {
      voice: 'shimmer',
      notes: [
        { at: 0.0, f: 1318.51, d: 1.2, vol: 0.07, pan: 0.4 },
        { at: 2.4, f: 880.0, d: 1.2, vol: 0.06, pan: -0.4 },
        { at: 4.8, f: 1108.73, d: 1.2, vol: 0.06, pan: 0.4 }
      ]
    }
  ]
}

/**
 * Исходящий — спокойнее и короче входящего: два такта (A → D), повтор 4.4 с.
 *
 * Так ждать ответа приятнее: частые «бипы» раздражают уже через полминуты.
 */
const OUTGOING_TUNE: RingTune = {
  loopMs: RING_OUTGOING_LOOP_MS,
  parts: [
    {
      voice: 'pad',
      notes: [
        { at: 0.0, f: 220.0, d: 2.4, vol: 0.09 },
        { at: 0.0, f: 329.63, d: 2.4, vol: 0.06 },
        { at: 2.2, f: 146.83, d: 2.4, vol: 0.09 },
        { at: 2.2, f: 220.0, d: 2.4, vol: 0.06 }
      ]
    },
    {
      voice: 'bass',
      notes: [
        { at: 0.0, f: 110.0, d: 2.0, vol: 0.14 },
        { at: 2.2, f: 146.83, d: 2.0, vol: 0.13 }
      ]
    },
    {
      voice: 'pluck',
      notes: [
        { at: 0.05, f: 440.0, d: 1.0, vol: 0.09, pan: -0.3 },
        { at: 0.4, f: 554.37, d: 1.0, vol: 0.08, pan: 0.3 },
        { at: 2.25, f: 369.99, d: 1.0, vol: 0.09, pan: -0.3 },
        { at: 2.6, f: 587.33, d: 1.0, vol: 0.08, pan: 0.3 }
      ]
    },
    {
      voice: 'bell',
      notes: [
        { at: 0.15, f: 659.25, d: 1.4, vol: 0.2 },
        { at: 2.35, f: 554.37, d: 1.4, vol: 0.18 }
      ]
    },
    {
      voice: 'shimmer',
      notes: [
        { at: 0.0, f: 1318.51, d: 1.0, vol: 0.05, pan: 0.35 },
        { at: 2.2, f: 880.0, d: 1.0, vol: 0.05, pan: -0.35 }
      ]
    }
  ]
}

/** Играет фразу (ноты перекрываются) и повторяет её после паузы. */
function scheduleRing(tune: RingTune) {
  if (ringTimer !== undefined) {
    window.clearTimeout(ringTimer)
  }
  ringTimer = window.setTimeout(function tick() {
    const ctx = audioContext
    if (!ctx) return
    const base = ctx.currentTime + 0.06
    tune.parts.forEach((part) => {
      part.notes.forEach((note) => playNote(part.voice, note, base + note.at))
    })
    ringTimer = window.setTimeout(tick, tune.loopMs)
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
    // Входящий — многоголосая фраза с колокольчиком; исходящему — спокойные гудки.
    if (kind === 'outgoing') {
      scheduleRing(OUTGOING_TUNE)
    } else {
      scheduleRing(INCOMING_TUNE)
      vibrateRing()
    }
  } catch {
    /* Аудио недоступно — звонок идёт без гудков */
  }
}
