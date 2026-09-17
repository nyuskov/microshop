/* --------------- Вывод звука собеседников (Web Audio gain) ---------------
   На телефонах/части браузеров element.volume у медиа-стримов игнорируется,
   поэтому «тихий» режим (до включения громкой связи) делаем через честный
   GainNode: громкость применяется гарантированно и не зависит от элемента.

   В групповом звонке звук идёт от НЕСКОЛЬКИХ собеседников сразу, поэтому
   источники держим все: раньше новый поток заменял прежний, и слышно было
   только последнего подключившегося. Плитки в сетке при этом глушатся (звук
   играет Web Audio) — иначе одна и та же речь звучала бы дважды с небольшой
   задержкой, и голос «расплывался» бы, как при искажениях. */
let callOutputCtx: AudioContext | null = null
let callOutputGain: GainNode | null = null
let callOutputStreams: MediaStream[] = []
let callOutputSources: MediaStreamAudioSourceNode[] = []

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

/** Подключает поток собеседника в цепочку вывода (после ontrack). */
export function wireRemoteOutput(stream: MediaStream | null) {
  if (!stream || stream.getAudioTracks().length === 0) return
  if (callOutputStreams.includes(stream)) return
  ensureCallOutput()
  if (!callOutputCtx || !callOutputGain) return
  try {
    const source = callOutputCtx.createMediaStreamSource(stream)
    source.connect(callOutputGain)
    callOutputStreams.push(stream)
    callOutputSources.push(source)
  } catch {
    /* не удалось подключить вывод — не критично */
  }
}

/** Отключает поток собеседника (он вышел из звонка или звонок закончился). */
export function unwireRemoteOutput(stream: MediaStream | null) {
  if (!stream) return
  const index = callOutputStreams.indexOf(stream)
  if (index === -1) return
  const source = callOutputSources[index]
  callOutputStreams = callOutputStreams.filter((item) => item !== stream)
  callOutputSources = callOutputSources.filter((_, position) => position !== index)
  try {
    source?.disconnect()
  } catch {
    /* уже отключён */
  }
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
  return callOutputSources.length
}

export function teardownCallOutput() {
  for (const source of callOutputSources) {
    try {
      source.disconnect()
    } catch {
      /* ignore */
    }
  }
  callOutputSources = []
  callOutputStreams = []
  callOutputGain = null
  if (callOutputCtx) {
    void callOutputCtx.close().catch(() => undefined)
    callOutputCtx = null
  }
}

/** Готов ли Web Audio вывод: контекст запущен и потоки собеседников подключены. */
export function remoteOutputReady(): boolean {
  return callOutputCtx !== null && callOutputCtx.state === 'running' && callOutputSources.length > 0
}
