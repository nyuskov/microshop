/**
 * Звук входящего сообщения — короткий «блип» без файла-ассета.
 *
 * Почему синтез, а не mp3: звук нужен в критическом пути PWA, а один короткий
 * файл — это ещё 20–40 КБ и запрос, который в офлайне/на плохой сети может не
 * дойти (тогда «звук не работает»). Две ноты с затуханием дают тот же эффект и
 * живут в коде, где их можно подправить числами.
 *
 * Тонкости, из-за которых звук обычно «молчит»:
 * - браузер не даёт играть до первого касания страницы (autoplay policy) —
 *   контекст создаём лениво, а `suspended` «оживляем» перед игрой;
 * - если приложение свёрнуто, звучит системный push: дублировать его своим
 *   звуком нельзя, поэтому играем только при видимой странице;
 * - пачка сообщений не должна превращаться в трель — не чаще раза в 1.2 с.
 */

/** Ключ настройки в localStorage: `'off'` — звук выключен (по умолчанию включён). */
export const MESSAGE_SOUND_KEY = 'pismo_message_sound'

/** Ключ выбора звука ПО ЧАТАМ: `{"<chatId>": "<пресет>"}` (как архив и пины). */
export const CHAT_SOUNDS_KEY = 'pismo_chat_sounds'

/** Пауза между звуками: пачка сообщений звучит один раз. */
export const MESSAGE_SOUND_MIN_GAP_MS = 1200

/** Громкость одной ноты (обе короткие, суммарно тихо — это не будильник). */
const NOTE_GAIN = 0.05

/** Доступные звуки сообщения. */
export type MessageSoundKey = 'default' | 'soft' | 'drop' | 'bright' | 'none'

/** Пресет звука: ноты задаются числами (частота, задержка, длительность). */
export interface MessageSoundPreset {
  key: MessageSoundKey
  label: string
  /** `[частота Гц, задержка с, длительность с]`; пустой список — тишина. */
  notes: [number, number, number][]
}

/**
 * Звуки на выбор. Все синтезируются из двух-трёх нот: файлы-ассеты не нужны, а
 * характер звука правится числами (см. `playNote`).
 */
export const MESSAGE_SOUNDS: MessageSoundPreset[] = [
  {
    key: 'default',
    label: 'Классика',
    notes: [
      [880, 0, 0.12],
      [1174.66, 0.085, 0.16]
    ]
  },
  { key: 'soft', label: 'Мягкий', notes: [[659.25, 0, 0.24]] },
  {
    key: 'drop',
    label: 'Капля',
    notes: [
      [987.77, 0, 0.1],
      [659.25, 0.07, 0.18]
    ]
  },
  {
    key: 'bright',
    label: 'Яркий',
    notes: [
      [783.99, 0, 0.09],
      [987.77, 0.06, 0.09],
      [1318.51, 0.12, 0.14]
    ]
  },
  { key: 'none', label: 'Без звука', notes: [] }
]

/** Пресет по ключу; незнакомый ключ (старая запись) — «Классика». */
export function messageSoundPreset(key: string | null | undefined): MessageSoundPreset {
  return MESSAGE_SOUNDS.find((item) => item.key === key) ?? MESSAGE_SOUNDS[0]
}

let context: AudioContext | null = null
let lastPlayedAt = 0

type AudioContextCtor = new () => AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/** Контекст WebAudio: создаётся при первом звуке, потом переиспользуется. */
function audioContext(): AudioContext | null {
  if (context) return context
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    /* нет прав/нет звуковой карты — просто молчим */
    return null
  }
  return context
}

/** Включён ли звук сообщений на этом устройстве. */
export function isMessageSoundEnabled(): boolean {
  try {
    return localStorage.getItem(MESSAGE_SOUND_KEY) !== 'off'
  } catch {
    // localStorage недоступен (приватный режим) — ведём себя как раньше.
    return true
  }
}

/** Включает/выключает звук сообщений на этом устройстве. */
export function setMessageSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(MESSAGE_SOUND_KEY, enabled ? 'on' : 'off')
  } catch {
    /* настройку сохранить негде — звук продолжит работать по умолчанию */
  }
}

/** Одна нота с мягкой атакой и затуханием. */
function playNote(
  ctx: AudioContext,
  frequency: number,
  delaySeconds: number,
  durationSeconds: number
): void {
  const start = ctx.currentTime + delaySeconds
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  // exponentialRamp не умеет 0 — начинаем с почти нуля.
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(NOTE_GAIN, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + durationSeconds + 0.02)
}

/**
 * Играет звук нового сообщения, если это уместно и возможно.
 *
 * `key` — звук выбранного чата («Без звука» у чата значит тишину именно для него),
 * `now` передаётся в тестах. Возвращает `true`, если звук действительно поставлен
 * в очередь: вызывающий код не должен угадывать, сработало ли ограничение.
 */
export function playIncomingMessageSound(
  key: MessageSoundKey = 'default',
  now: number = Date.now()
): boolean {
  if (!isMessageSoundEnabled()) return false
  // Свёрнутое приложение — это системный push со своим звуком: не дублируем.
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
  if (now - lastPlayedAt < MESSAGE_SOUND_MIN_GAP_MS) return false

  const preset = messageSoundPreset(key)
  if (!preset.notes.length) return false

  const ctx = audioContext()
  if (!ctx) return false
  // Первый звук до касания страницы: контекст спит — будим (без ожидания,
  // чтобы не задерживать отрисовку; если не проснётся — сыграет в следующий раз).
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

  lastPlayedAt = now
  for (const [frequency, delay, duration] of preset.notes) {
    playNote(ctx, frequency, delay, duration)
  }
  return true
}

/* ---------------- Звук для конкретного чата ---------------- */

/**
 * Звуки, выбранные по чатам: `{"<chatId>": "<пресет>"}`.
 *
 * Хранится локально (как архив и пины): это настройка вида «на этом устройстве»,
 * серверу она не нужна. Нет записи — звук по умолчанию.
 */
function readChatSounds(): Record<string, MessageSoundKey> {
  try {
    const raw = localStorage.getItem(CHAT_SOUNDS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, MessageSoundKey> = {}
    for (const [chatId, key] of Object.entries(parsed as Record<string, unknown>)) {
      // Значение могло устареть (пресет убрали) — кладём только известные ключи.
      if (typeof key === 'string' && MESSAGE_SOUNDS.some((item) => item.key === key)) {
        result[chatId] = key as MessageSoundKey
      }
    }
    return result
  } catch {
    // Битый JSON / приватный режим — ведём себя как «настройки нет».
    return {}
  }
}

/** Звук этого чата; `null` — «по умолчанию» (включая тумблер устройства). */
export function chatSoundKey(chatId: number): MessageSoundKey | null {
  return readChatSounds()[String(chatId)] ?? null
}

/** Записывает звук чата; `null` — вернуть чат к звуку по умолчанию. */
export function setChatSoundKey(chatId: number, key: MessageSoundKey | null): void {
  try {
    const sounds = readChatSounds()
    if (key === null) delete sounds[String(chatId)]
    else sounds[String(chatId)] = key
    localStorage.setItem(CHAT_SOUNDS_KEY, JSON.stringify(sounds))
  } catch {
    /* сохранить негде — чат останется со звуком по умолчанию */
  }
}

/** Сбрасывает историю звуков (только для тестов: не влияет на работу приложения). */
export function resetMessageSoundState(): void {
  lastPlayedAt = 0
  context = null
}
