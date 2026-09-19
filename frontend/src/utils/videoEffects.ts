/**
 * Эффекты и «маски» для видеозвонка: цвет кадра, «мягкая кожа», виньетка и
 * маска-наклейка (кошачьи ушки, очки и т.п.), которую можно двигать пальцем.
 *
 * Почему без распознавания лица: трекинг лица — это модель на несколько
 * мегабайт и заметный нагрев телефона, а в звонке процессор уже занят кодированием
 * видео (в группе — по потоку на участника). Поэтому здесь только то, что
 * считается на лету: цвет кадра и нарисованные векторные маски. Маску человек
 * ставит сам — потянул и поставил (см. `framePointFromPointer`).
 *
 * Модуль без DOM: рисует по переданному 2D-контексту, поэтому геометрию масок и
 * положение под пальцем можно проверять тестами, а не глазами.
 *
 * Мелкие настройки (id «без эффекта», пределы размера маски, проверка поддержки)
 * лежат в `videoEffectSettings.ts` — их берёт ещё и стор звонка, которому
 * тяжёлые таблицы масок в основном чанке не нужны. Здесь они реэкспортируются,
 * чтобы импорт оставался один.
 */

import {
  DEFAULT_MASK_LAYOUT,
  DEFAULT_VIDEO_EFFECT,
  MASK_SCALE_MAX,
  MASK_SCALE_MIN,
  clampMaskLayout,
  isVideoEffectsSupported,
  type MaskLayout
} from '@/utils/videoEffectSettings'

export {
  DEFAULT_MASK_LAYOUT,
  DEFAULT_VIDEO_EFFECT,
  MASK_SCALE_MAX,
  MASK_SCALE_MIN,
  clampMaskLayout,
  isVideoEffectsSupported
}
export type { MaskLayout }

/** Что можно сделать с кадром. */
export interface VideoEffectPreset {
  id: string
  title: string
  /** Фильтр кадра: canvas 2D понимает его как `ctx.filter`. */
  filter: string
  /** Мягкое размытие поверх кадра — сглаживает кожу, не превращая в «пластик». */
  soft?: boolean
  /** Насколько притемнить края (0..1): «киношная» виньетка. */
  vignette?: number
}

/** Пресеты эффектов. Первый — «выключено». */
export const VIDEO_EFFECTS: VideoEffectPreset[] = [
  { id: 'none', title: 'Без эффекта', filter: 'none' },
  { id: 'warm', title: 'Тёплый', filter: 'saturate(1.12) contrast(1.04) sepia(0.14)' },
  { id: 'cool', title: 'Холодный', filter: 'saturate(1.04) hue-rotate(-10deg) brightness(1.03)' },
  { id: 'mono', title: 'Ч/б', filter: 'grayscale(1) contrast(1.08)' },
  {
    id: 'film',
    title: 'Плёнка',
    filter: 'sepia(0.3) contrast(1.12) saturate(0.92)',
    vignette: 0.35
  },
  { id: 'soft', title: 'Мягкая кожа', filter: 'brightness(1.05) saturate(1.04)', soft: true }
]

export const videoEffectById = (id: string): VideoEffectPreset =>
  VIDEO_EFFECTS.find((item) => item.id === id) ?? VIDEO_EFFECTS[0]

// ---------- Маски ----------

/**
 * Фигура маски в единичном квадрате: (0,0) — левый верхний угол маски, (1,1) —
 * правый нижний. Так фигуры не зависят от размера кадра и от размера маски.
 */
export type MaskShape =
  | {
      kind: 'ellipse'
      cx: number
      cy: number
      rx: number
      ry: number
      fill: string
      /** Поворот, градусы (для ушей и усов). */
      rotate?: number
      /** Вырезать фигуру из маски (прозрачная дырка) — так делаются линзы очков. */
      cut?: boolean
    }
  | { kind: 'polygon'; points: Array<[number, number]>; fill: string; cut?: boolean }

export interface MaskPreset {
  id: string
  title: string
  shapes: MaskShape[]
}

/**
 * Маски рисуем векторами, а не картинками: не нужны файлы, кеш и сеть, а цвет
 * подбирается под тему. Узнаваемость держим силуэтом — уши, нос, усы.
 */
export const VIDEO_MASKS: MaskPreset[] = [
  {
    id: 'cat',
    title: 'Кошка',
    shapes: [
      {
        kind: 'polygon',
        points: [
          [0.06, 0.42],
          [0.2, 0],
          [0.44, 0.34]
        ],
        fill: '#3f3a3a'
      },
      {
        kind: 'polygon',
        points: [
          [0.56, 0.34],
          [0.8, 0],
          [0.94, 0.42]
        ],
        fill: '#3f3a3a'
      },
      {
        kind: 'polygon',
        points: [
          [0.16, 0.34],
          [0.22, 0.12],
          [0.33, 0.32]
        ],
        fill: '#e59aa8'
      },
      {
        kind: 'polygon',
        points: [
          [0.67, 0.32],
          [0.78, 0.12],
          [0.84, 0.34]
        ],
        fill: '#e59aa8'
      },
      { kind: 'ellipse', cx: 0.5, cy: 0.52, rx: 0.05, ry: 0.04, fill: '#e59aa8' },
      { kind: 'ellipse', cx: 0.12, cy: 0.56, rx: 0.14, ry: 0.008, fill: '#f2f2f2' },
      { kind: 'ellipse', cx: 0.88, cy: 0.56, rx: 0.14, ry: 0.008, fill: '#f2f2f2' }
    ]
  },
  {
    id: 'dog',
    title: 'Собака',
    shapes: [
      { kind: 'ellipse', cx: 0.14, cy: 0.16, rx: 0.13, ry: 0.2, fill: '#6b4a2f' },
      { kind: 'ellipse', cx: 0.86, cy: 0.16, rx: 0.13, ry: 0.2, fill: '#6b4a2f' },
      { kind: 'ellipse', cx: 0.5, cy: 0.56, rx: 0.11, ry: 0.08, fill: '#3f3a3a' },
      { kind: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.05, ry: 0.03, fill: '#2b2828' },
      { kind: 'ellipse', cx: 0.5, cy: 0.68, rx: 0.05, ry: 0.06, fill: '#e2686f' }
    ]
  },
  {
    id: 'glasses',
    title: 'Очки',
    shapes: [
      { kind: 'ellipse', cx: 0.26, cy: 0.48, rx: 0.22, ry: 0.15, fill: '#20242a' },
      { kind: 'ellipse', cx: 0.74, cy: 0.48, rx: 0.22, ry: 0.15, fill: '#20242a' },
      { kind: 'ellipse', cx: 0.26, cy: 0.48, rx: 0.19, ry: 0.12, fill: '#000000', cut: true },
      { kind: 'ellipse', cx: 0.74, cy: 0.48, rx: 0.19, ry: 0.12, fill: '#000000', cut: true },
      {
        kind: 'polygon',
        points: [
          [0.46, 0.46],
          [0.54, 0.46],
          [0.54, 0.5],
          [0.46, 0.5]
        ],
        fill: '#20242a'
      }
    ]
  },
  {
    id: 'crown',
    title: 'Корона',
    shapes: [
      {
        kind: 'polygon',
        points: [
          [0.08, 0.4],
          [0.08, 0.08],
          [0.29, 0.24],
          [0.5, 0.02],
          [0.71, 0.24],
          [0.92, 0.08],
          [0.92, 0.4]
        ],
        fill: '#e8c14a'
      },
      { kind: 'ellipse', cx: 0.29, cy: 0.3, rx: 0.03, ry: 0.03, fill: '#c94f5a' },
      { kind: 'ellipse', cx: 0.5, cy: 0.3, rx: 0.03, ry: 0.03, fill: '#4f79c9' },
      { kind: 'ellipse', cx: 0.71, cy: 0.3, rx: 0.03, ry: 0.03, fill: '#c94f5a' }
    ]
  }
]

export const maskById = (id: string | null): MaskPreset | null =>
  id === null ? null : (VIDEO_MASKS.find((item) => item.id === id) ?? null)

/** Где стоит маска — тип и пределы в `videoEffectSettings.ts` (реэкспорт выше). */

/** Прямоугольник маски в пикселях кадра (квадрат со стороной от ширины кадра). */
export const maskBoxFor = (
  layout: MaskLayout,
  frame: { width: number; height: number }
): { left: number; top: number; size: number } => {
  const size = frame.width * clampMaskLayout(layout).scale
  return {
    left: layout.x * frame.width - size / 2,
    top: layout.y * frame.height - size / 2,
    size
  }
}

/**
 * Точка кадра под пальцем.
 *
 * Кадр показывается как `object-fit: cover` (без искажений), а передняя камера
 * ещё и зеркалится в превью — поэтому «где палец» и «где маска в кадре» — не одно
 * и то же. Считаем по настоящим размерам кадра, иначе на телефоне маска
 * уезжает от пальца тем сильнее, чем больше отличается соотношение сторон.
 */
export const framePointFromPointer = (input: {
  /** Прямоугольник элемента видео (из `getBoundingClientRect`). */
  rect: { left: number; top: number; width: number; height: number }
  /** Размер кадра: `track.getSettings()` или `videoWidth/videoHeight`. */
  frame: { width: number; height: number }
  /** Показывается ли превью зеркально (передняя камера). */
  mirrored: boolean
  clientX: number
  clientY: number
}): { x: number; y: number } => {
  const { rect, frame, mirrored } = input
  const frameWidth = frame.width > 0 ? frame.width : 1
  const frameHeight = frame.height > 0 ? frame.height : 1
  if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 }
  // `cover`: кадр масштабируется по большей стороне и обрезается по меньшей.
  const scale = Math.max(rect.width / frameWidth, rect.height / frameHeight)
  const drawnWidth = frameWidth * scale
  const drawnHeight = frameHeight * scale
  const offsetX = (rect.width - drawnWidth) / 2
  const offsetY = (rect.height - drawnHeight) / 2
  const x = (input.clientX - rect.left - offsetX) / drawnWidth
  const y = (input.clientY - rect.top - offsetY) / drawnHeight
  return { x: mirrored ? 1 - x : x, y }
}

// ---------- Рисование ----------

/** Контекст 2D, которого достаточно для рисования (для тестов — заглушка). */
export interface DrawContext {
  save(): void
  restore(): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number
  ): void
  fill(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  fillStyle: string | CanvasGradient | CanvasPattern
  globalCompositeOperation: string
  filter: string
  globalAlpha: number
}

const polygonPath = (ctx: DrawContext, points: Array<[number, number]>, size: number): void => {
  ctx.beginPath()
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * size, y * size)
    else ctx.lineTo(x * size, y * size)
  })
  ctx.closePath()
}

/**
 * Рисует маску в прямоугольнике (в пикселях кадра).
 *
 * Фигуры с `cut` вырезают дырку: без этого линзы очков были бы чёрными
 * кружками, а человек в них ничего не видит.
 */
export const drawMask = (
  ctx: DrawContext,
  mask: MaskPreset,
  layout: MaskLayout,
  frame: { width: number; height: number }
): void => {
  const box = maskBoxFor(layout, frame)
  ctx.save()
  ctx.translate(box.left, box.top)
  for (const shape of mask.shapes) {
    ctx.save()
    if (shape.kind === 'ellipse') {
      if (shape.rotate) {
        ctx.translate(shape.cx * box.size, shape.cy * box.size)
        ctx.rotate((shape.rotate * Math.PI) / 180)
        ctx.translate(-shape.cx * box.size, -shape.cy * box.size)
      }
      ctx.beginPath()
      ctx.ellipse(
        shape.cx * box.size,
        shape.cy * box.size,
        shape.rx * box.size,
        shape.ry * box.size,
        0,
        0,
        Math.PI * 2
      )
    } else {
      polygonPath(ctx, shape.points, box.size)
    }
    if (shape.cut) {
      ctx.globalCompositeOperation = 'destination-out'
    }
    ctx.fillStyle = shape.fill
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

/**
 * Рисует кадр с эффектом.
 *
 * Кадр рисуется один раз с фильтром; «мягкая кожа» — это второй проход размытой
 * копией поверх (`soft-light` не нужен: полупрозрачное светлое размытие и так
 * убирает резкость мелких деталей кожи). Виньетка — радиальный градиент по краям.
 */
export const drawVideoFrame = (
  ctx: DrawContext & {
    createRadialGradient?(
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number
    ): { addColorStop(offset: number, color: string): void }
    drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
  },
  source: CanvasImageSource,
  effect: VideoEffectPreset,
  frame: { width: number; height: number }
): void => {
  ctx.save()
  ctx.filter = effect.filter
  ctx.drawImage(source, 0, 0, frame.width, frame.height)
  if (effect.soft) {
    ctx.globalAlpha = 0.32
    ctx.filter = 'blur(4px) brightness(1.06)'
    ctx.drawImage(source, 0, 0, frame.width, frame.height)
  }
  ctx.restore()
  if (effect.vignette && ctx.createRadialGradient) {
    const gradient = ctx.createRadialGradient(
      frame.width / 2,
      frame.height / 2,
      Math.min(frame.width, frame.height) * 0.25,
      frame.width / 2,
      frame.height / 2,
      Math.max(frame.width, frame.height) * 0.75
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, `rgba(0, 0, 0, ${effect.vignette})`)
    ctx.save()
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.ellipse(
      frame.width / 2,
      frame.height / 2,
      frame.width / 2,
      frame.height / 2,
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
    ctx.restore()
  }
}
