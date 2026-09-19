/**
 * Обработка СВОЕГО видео перед отправкой: эффекты и маски.
 *
 * Схема как у «виртуальной камеры»: кадр с камеры проходит через canvas, а
 * собеседники получают дорожку этого canvas (`captureStream`). Дорожка
 * подменяется тем же способом, что и при смене камеры или показе экрана
 * (`replaceTrack` во все связи), поэтому пересогласование не нужно.
 *
 * Почему canvas, а не «фильтры на элементе видео»: `filter` у `<video>` виден
 * только у себя в интерфейсе — собеседник получал бы исходный кадр. Здесь же
 * эффект попадает именно в медиапоток.
 *
 * Нагрузка. Обработка идёт на своём устройстве и на каждую связь не повторяется
 * (одна дорожка уходит всем участникам). Частоту кадров держим не выше частоты
 * захвата, размер — не больше 1280 px по ширине: телефоны греются от лишней
 * работы, а разница на экране не видна.
 */

import {
  drawMask,
  drawVideoFrame,
  isVideoEffectsSupported,
  maskById,
  videoEffectById,
  type MaskLayout
} from '@/utils/videoEffects'

/** Что именно применяем: эффект цвета и/или маска. */
export interface VideoEffectsSettings {
  effectId: string
  maskId: string | null
  maskLayout: MaskLayout
}

/** Частота обработки: выше частоты камеры смысла нет (24–30 к/с). */
const CAPTURE_FPS = 24
/** Предел ширины кадра: 640×480 и 1280×720 обрабатываются одинаково охотно. */
const MAX_FRAME_WIDTH = 1280
/** Размер кадра по умолчанию, если камера не сказала свой (v4l2, виртуальные). */
const FALLBACK_FRAME = { width: 640, height: 480 }

/** Объект обработки, живущий рядом с рантаймом звонка (вне реактивности). */
export interface VideoEffectsRuntime {
  /** Обработанная дорожка: её и отдаём собеседникам. */
  track: MediaStreamTrack
  /** Меняет источник кадров (после смены камеры). */
  setSource(track: MediaStreamTrack): void
  /** Останавливает обработку и гасит дорожку. */
  stop(): void
}

/** Можно ли вообще включать эффекты в этом браузере. */
export const videoEffectsSupported = (): boolean => isVideoEffectsSupported()

/**
 * Запускает обработку кадров с камеры.
 *
 * `settings` — функция, а не значение: эффект и маска меняются на ходу, и
 * перезапускать обработку ради этого не нужно (и нельзя — это разрыв видео).
 */
export function startVideoEffects(
  source: MediaStreamTrack,
  settings: () => VideoEffectsSettings,
  options: { fps?: number; maxWidth?: number } = {}
): VideoEffectsRuntime {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  setSourceStream(video, source)
  void video.play().catch(() => undefined)

  const size = frameSizeOf(source, options.maxWidth ?? MAX_FRAME_WIDTH)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas недоступен — эффекты включить нельзя')

  const capture =
    canvas.captureStream?.bind(canvas) ??
    (
      canvas as HTMLCanvasElement & { mozCaptureStream?: (fps?: number) => MediaStream }
    ).mozCaptureStream?.bind(canvas)
  if (!capture) throw new Error('Браузер не умеет снимать поток с canvas')
  const output = capture(options.fps ?? CAPTURE_FPS)
  const track = output.getVideoTracks()[0]
  if (!track) throw new Error('Не удалось получить обработанную дорожку')

  let running = true
  let rafId = 0
  const interval = 1000 / (options.fps ?? CAPTURE_FPS)
  let lastDraw = 0

  const draw = (timestamp: number) => {
    if (!running) return
    rafId = window.requestAnimationFrame(draw)
    // Рисуем не чаще заданной частоты: лишние кадры только греют устройство, а
    // захват всё равно ограничен.
    if (timestamp - lastDraw < interval) return
    lastDraw = timestamp
    // Свёрнутая вкладка/приложение: кадры не приходят, рисовать нечего.
    if (document.hidden || video.readyState < 2) return
    const current = settings()
    const effect = videoEffectById(current.effectId)
    const mask = maskById(current.maskId)
    const frame = { width: canvas.width, height: canvas.height }
    context.clearRect(0, 0, frame.width, frame.height)
    drawVideoFrame(context, video, effect, frame)
    if (mask) drawMask(context, mask, current.maskLayout, frame)
  }
  rafId = window.requestAnimationFrame(draw)

  return {
    track,
    setSource(next: MediaStreamTrack) {
      setSourceStream(video, next)
      const nextSize = frameSizeOf(next, options.maxWidth ?? MAX_FRAME_WIDTH)
      if (nextSize.width !== canvas.width || nextSize.height !== canvas.height) {
        canvas.width = nextSize.width
        canvas.height = nextSize.height
      }
      void video.play().catch(() => undefined)
    },
    stop() {
      running = false
      window.cancelAnimationFrame(rafId)
      video.srcObject = null
      track.stop()
      for (const item of output.getTracks()) item.stop()
    }
  }
}

/** Отдаёт элементу видео ровно одну дорожку (звук обрабатывается отдельно). */
function setSourceStream(video: HTMLVideoElement, track: MediaStreamTrack): void {
  video.srcObject = new MediaStream([track])
}

/** Размер кадра из настроек дорожки (иначе — разумное умолчание). */
function frameSizeOf(track: MediaStreamTrack, maxWidth: number): { width: number; height: number } {
  const settings = track.getSettings?.() ?? {}
  const width = settings.width ?? FALLBACK_FRAME.width
  const height = settings.height ?? FALLBACK_FRAME.height
  if (width <= maxWidth) return { width, height }
  const ratio = height / width
  return { width: maxWidth, height: Math.round(maxWidth * ratio) }
}
