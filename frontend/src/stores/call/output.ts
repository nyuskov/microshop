/* --------------- Вывод звука собеседника (Web Audio gain) ---------------
   На телефонах/части браузеров element.volume у медиа-стримов игнорируется,
   поэтому «тихий» режим (до включения громкой связи) делаем через честный
   GainNode: громкость применяется гарантированно и не зависит от элемента. */
let callOutputCtx: AudioContext | null = null
let callOutputGain: GainNode | null = null
let callOutputSource: MediaStreamAudioSourceNode | null = null
let callOutputStream: MediaStream | null = null

/** Создаёт/возобновляет контекст вывода. Звать в жесте пользователя. */
export function ensureCallOutput() {
  if (!callOutputCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    callOutputCtx = new Ctor()
    callOutputGain = callOutputCtx.createGain()
    callOutputGain.gain.value = 0.12
    callOutputGain.connect(callOutputCtx.destination)
  }
  if (callOutputCtx.state === 'suspended') {
    void callOutputCtx.resume().catch(() => undefined)
  }
}

/** Подключает удалённый поток в цепочку вывода (после ontrack). */
export function wireRemoteOutput(stream: MediaStream | null) {
  if (!stream || stream.getAudioTracks().length === 0) return
  if (stream === callOutputStream && callOutputSource) return
  if (callOutputSource) {
    try {
      callOutputSource.disconnect()
    } catch {
      /* ignore */
    }
    callOutputSource = null
  }
  ensureCallOutput()
  if (!callOutputCtx || !callOutputGain) return
  try {
    callOutputSource = callOutputCtx.createMediaStreamSource(stream)
    callOutputSource.connect(callOutputGain)
    callOutputStream = stream
  } catch {
    /* не удалось подключить вывод — не критично */
  }
}

/** Громкость собеседника: 1 — громко, меньше — «к уху». */
export function setRemoteOutputVolume(volume: number) {
  if (callOutputGain && callOutputCtx) {
    callOutputGain.gain.setValueAtTime(volume, callOutputCtx.currentTime)
  }
}

export function teardownCallOutput() {
  if (callOutputSource) {
    try {
      callOutputSource.disconnect()
    } catch {
      /* ignore */
    }
    callOutputSource = null
  }
  callOutputGain = null
  callOutputStream = null
  if (callOutputCtx) {
    void callOutputCtx.close().catch(() => undefined)
    callOutputCtx = null
  }
}

/** Готов ли Web Audio вывод: контекст запущен и поток собеседника подключён. */
export function remoteOutputReady(): boolean {
  return callOutputCtx !== null && callOutputCtx.state === 'running' && callOutputSource !== null
}
