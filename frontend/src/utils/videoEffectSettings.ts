/**
 * Мелкие настройки эффектов видео — без таблиц масок и рисования.
 *
 * Зачем отдельно: `utils/videoEffects.ts` тянет за собой пресеты, фигуры масок и
 * функции рисования, а основному чанку приложения (стор звонка) нужны только
 * «без эффекта», точка по умолчанию и пределы размера. Импорт всего модуля
 * прибавлял к главному чанку килобайты, которые нужны лишь когда человек открыл
 * звонок и включил эффект.
 */

/** Эффект по умолчанию — никакой. */
export const DEFAULT_VIDEO_EFFECT = 'none'

/** Где стоит маска: центр — в долях кадра, размер — в долях ширины кадра. */
export interface MaskLayout {
  x: number
  y: number
  scale: number
}

/** По умолчанию маска «на голове» — чуть выше центра кадра. */
export const DEFAULT_MASK_LAYOUT: MaskLayout = { x: 0.5, y: 0.3, scale: 0.45 }

/** Пределы размера: совсем мелкую маску не найти, огромная закрывает лицо. */
export const MASK_SCALE_MIN = 0.18
export const MASK_SCALE_MAX = 1.1

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Приводит положение маски к допустимому (человек может утянуть её за край). */
export const clampMaskLayout = (layout: MaskLayout): MaskLayout => ({
  x: clamp(layout.x, -0.1, 1.1),
  y: clamp(layout.y, -0.1, 1.1),
  scale: clamp(layout.scale, MASK_SCALE_MIN, MASK_SCALE_MAX)
})

/** Есть ли в браузере всё нужное для эффектов (иначе кнопку не показываем). */
export const isVideoEffectsSupported = (canvas?: {
  captureStream?: unknown
  mozCaptureStream?: unknown
}): boolean => {
  const element: { captureStream?: unknown; mozCaptureStream?: unknown } | undefined =
    canvas ?? (typeof document === 'undefined' ? undefined : document.createElement('canvas'))
  if (!element) return false
  return (
    typeof element.captureStream === 'function' || typeof element.mozCaptureStream === 'function'
  )
}
