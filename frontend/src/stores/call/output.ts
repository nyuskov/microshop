/* --------------- Вывод звука собеседников (Web Audio gain) ---------------
   На телефонах/части браузеров element.volume у медиа-стримов игнорируется,
   поэтому «тихий» режим (до включения громкой связи) делаем через честный
   GainNode: громкость применяется гарантированно и не зависит от элемента.

   В групповом звонке звук идёт от НЕСКОЛЬКИХ собеседников сразу, поэтому
   источники держим все: раньше новый поток заменял прежний, и слышно было
   только последнего подключившегося. Плитки в сетке при этом глушатся (звук
   играет Web Audio) — иначе одна и та же речь звучала бы дважды с небольшой
   задержкой, и голос «расплывался» бы, как при искажениях.

   Здесь же измеряется УРОВЕНЬ речи собеседника — из него складывается признак
   «говорит» (кольцо на плитке). Своего анализатора не избежать: Chrome считает
   `audioLevel` только в пути ВОСПРОИЗВЕДЕНИЯ элементом, а в групповом звонке
   звук идёт через Web Audio, и там `audioLevel` остаётся нулевым (проверено
   живьём 18.09.2026: тон 0,5 — элемент даёт 0,506, Web Audio — 0). */
let callOutputCtx: AudioContext | null = null
let callOutputGain: GainNode | null = null

/** Один источник вывода: поток собеседника, его анализатор и буфер отсчётов. */
interface RemoteOutput {
  peerId: number
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  buffer: Float32Array
}

const callOutputs: RemoteOutput[] = []

/** Размер окна измерения уровня: 512 отсчётов ≈ 10 мс при 48 кГц. */
const LEVEL_FFT_SIZE = 512

/** Громкость «у уха»: слышно, но не орёт на всю комнату. */
export const EARPICE_VOLUME = 0.12

/** Создаёт/возобновляет контекст вывода. Звать в жесте пользователя. */
export function ensureCallOutput() {
  if (!callOutputCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    callOutputCtx = new Ctor()
    callOutputGain = callOutputCtx.createGain()
    callOutputGain.gain.value = EARPICE_VOLUME
    callOutputGain.connect(callOutputCtx.destination)
  }
  if (callOutputCtx.state === 'suspended') {
    void callOutputCtx.resume().catch(() => undefined)
  }
}

/**
 * Среднеквадратичный уровень сигнала (RMS) — «насколько громко сейчас».
 *
 * Чистая функция: буфер заполняет вызывающий, поэтому её видно тестами.
 * Пороги «говорит» (`speakingNow` в `utils/callStats.ts`) рассчитаны на такую же
 * шкалу 0…1, что и Chrome: тон амплитуды 0,5 дал в браузере уровень ≈0,5.
 */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

/**
 * Подключает поток собеседника в цепочку вывода (после ontrack).
 *
 * `peerId` нужен для измерения уровня: по нему уровень расходится по плиткам.
 */
export function wireRemoteOutput(stream: MediaStream | null, peerId: number) {
  if (!stream || stream.getAudioTracks().length === 0) return
  if (callOutputs.some((item) => item.stream === stream)) return
  ensureCallOutput()
  if (!callOutputCtx || !callOutputGain) return
  try {
    const source = callOutputCtx.createMediaStreamSource(stream)
    // Анализатор — ДО громкости: измеряем то, что пришло от собеседника, а не
    // то, как громко мы это у себя выкрутили.
    const analyser = callOutputCtx.createAnalyser()
    analyser.fftSize = LEVEL_FFT_SIZE
    source.connect(analyser)
    analyser.connect(callOutputGain)
    callOutputs.push({
      peerId,
      stream,
      source,
      analyser,
      buffer: new Float32Array(analyser.fftSize)
    })
  } catch {
    /* не удалось подключить вывод — не критично */
  }
}

/** Отключает поток собеседника (он вышел из звонка или звонок закончился). */
export function unwireRemoteOutput(stream: MediaStream | null) {
  if (!stream) return
  const index = callOutputs.findIndex((item) => item.stream === stream)
  if (index === -1) return
  const [removed] = callOutputs.splice(index, 1)
  try {
    removed.source.disconnect()
    removed.analyser.disconnect()
  } catch {
    /* уже отключён */
  }
}

/**
 * Уровни речи по собеседникам (peerId → 0…1).
 *
 * Зовётся часто (несколько раз в секунду) — поэтому только чтение буфера и RMS,
 * без создания объектов на каждого собеседника, кроме возвращаемой карты.
 */
export function remoteLevels(): Map<number, number> {
  const levels = new Map<number, number>()
  for (const item of callOutputs) {
    try {
      item.analyser.getFloatTimeDomainData(item.buffer)
      levels.set(item.peerId, rmsLevel(item.buffer))
    } catch {
      /* анализатор уже отключён */
    }
  }
  return levels
}

/**
 * Громкость собеседников: 1 — громко, меньше — «к уху».
 *
 * Меняем плавно (30 мс): мгновенная смена слышна как щелчок в динамике.
 */
export function setRemoteOutputVolume(volume: number) {
  if (callOutputGain && callOutputCtx) {
    const now = callOutputCtx.currentTime
    callOutputGain.gain.cancelScheduledValues(now)
    callOutputGain.gain.setValueAtTime(callOutputGain.gain.value, now)
    callOutputGain.gain.linearRampToValueAtTime(volume, now + 0.03)
  }
}

/** Сколько собеседников подключено к выводу (диагностика). */
export function remoteOutputCount(): number {
  return callOutputs.length
}

export function teardownCallOutput() {
  for (const item of callOutputs) {
    try {
      item.source.disconnect()
      item.analyser.disconnect()
    } catch {
      /* ignore */
    }
  }
  callOutputs.length = 0
  callOutputGain = null
  if (callOutputCtx) {
    void callOutputCtx.close().catch(() => undefined)
    callOutputCtx = null
  }
}

/** Готов ли Web Audio вывод: контекст запущен и потоки собеседников подключены. */
export function remoteOutputReady(): boolean {
  return callOutputCtx !== null && callOutputCtx.state === 'running' && callOutputs.length > 0
}
