import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MASK_LAYOUT,
  DEFAULT_VIDEO_EFFECT,
  MASK_SCALE_MAX,
  MASK_SCALE_MIN,
  VIDEO_EFFECTS,
  VIDEO_MASKS,
  clampMaskLayout,
  drawMask,
  drawVideoFrame,
  framePointFromPointer,
  isVideoEffectsSupported,
  maskBoxFor,
  maskById,
  videoEffectById
} from '@/utils/videoEffects'
import type { DrawContext } from '@/utils/videoEffects'

/**
 * Эффекты и маски видео.
 *
 * Картинку юнит-тестами не проверить, поэтому проверяем то, что можно посчитать:
 * геометрию фигур, пределы размера, положение маски под пальцем (с обрезкой
 * «cover» и зеркалом) и доступность эффектов. Сюда же — вызовы рисования:
 * заглушка контекста показывает, что маска и виньетка действительно рисуются, а
 * «дырки» в очках вырезаются, а не закрашиваются.
 */

/** Заглушка 2D-контекста: запоминает вызовы, чтобы их можно было проверить. */
const fakeContext = () => {
  const calls: string[] = []
  //: Устанавливаемые режимы наложения: по ним видно, что линзы именно вырезаны.
  const compositeOps: string[] = []
  const ellipse = vi.fn(() => calls.push('ellipse'))
  const ctx = {
    calls,
    compositeOps,
    ellipse,
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    closePath: vi.fn(() => calls.push('closePath')),
    moveTo: vi.fn(() => calls.push('moveTo')),
    lineTo: vi.fn(() => calls.push('lineTo')),
    fill: vi.fn(() => calls.push('fill')),
    translate: vi.fn(() => calls.push('translate')),
    rotate: vi.fn(() => calls.push('rotate')),
    clearRect: vi.fn(),
    drawImage: vi.fn(() => calls.push('drawImage')),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(() => calls.push('addColorStop'))
    })),
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    filter: 'none',
    globalAlpha: 1,
    composite: 'source-over',
    get globalCompositeOperation() {
      return this.composite
    },
    set globalCompositeOperation(value: string) {
      this.composite = value
      compositeOps.push(value)
    }
  }
  return ctx
}

describe('наборы эффектов и масок', () => {
  it('первый эффект — «без эффекта», у каждого своё имя и фильтр', () => {
    expect(VIDEO_EFFECTS[0].id).toBe(DEFAULT_VIDEO_EFFECT)
    expect(new Set(VIDEO_EFFECTS.map((item) => item.title)).size).toBe(VIDEO_EFFECTS.length)
    for (const preset of VIDEO_EFFECTS) expect(preset.filter).not.toBe('')
  })

  it('неизвестный id не ломает звонок: берём «без эффекта»', () => {
    expect(videoEffectById('такого нет').id).toBe(DEFAULT_VIDEO_EFFECT)
    expect(videoEffectById('warm').title).toBe('Тёплый')
    expect(maskById(null)).toBeNull()
    expect(maskById('такой нет')).toBeNull()
  })

  it('у каждой маски есть фигуры в единичном квадрате', () => {
    expect(VIDEO_MASKS.length).toBeGreaterThanOrEqual(3)
    for (const mask of VIDEO_MASKS) {
      expect(mask.shapes.length).toBeGreaterThan(0)
      for (const shape of mask.shapes) {
        if (shape.kind === 'ellipse') {
          expect(shape.rx).toBeGreaterThan(0)
          expect(shape.ry).toBeGreaterThan(0)
          // Фигура должна попадать в квадрат маски, иначе она уедет за её край.
          expect(shape.cx - shape.rx).toBeGreaterThanOrEqual(-0.05)
          expect(shape.cx + shape.rx).toBeLessThanOrEqual(1.05)
          expect(shape.cy - shape.ry).toBeGreaterThanOrEqual(-0.05)
          expect(shape.cy + shape.ry).toBeLessThanOrEqual(1.05)
        } else {
          for (const [x, y] of shape.points) {
            expect(x).toBeGreaterThanOrEqual(-0.05)
            expect(x).toBeLessThanOrEqual(1.05)
            expect(y).toBeGreaterThanOrEqual(-0.05)
            expect(y).toBeLessThanOrEqual(1.05)
          }
        }
        expect(shape.fill).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })
})

describe('положение и размер маски', () => {
  it('размер и координаты держатся в допустимых пределах', () => {
    expect(clampMaskLayout({ x: -5, y: 5, scale: 99 })).toEqual({
      x: -0.1,
      y: 1.1,
      scale: MASK_SCALE_MAX
    })
    expect(clampMaskLayout({ x: 0.5, y: 0.5, scale: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
      scale: MASK_SCALE_MIN
    })
  })

  it('рамка маски — квадрат по центру кадра, сторона — доля ширины', () => {
    const box = maskBoxFor({ x: 0.5, y: 0.5, scale: 0.5 }, { width: 640, height: 480 })

    expect(box.size).toBe(320)
    expect(box.left).toBe(160)
    // Половина высоты кадра минус половина маски: маска стоит по центру.
    expect(box.top).toBe(80)
  })

  it('маска по умолчанию — выше центра: там голова, а не грудь', () => {
    expect(DEFAULT_MASK_LAYOUT.y).toBeLessThan(0.5)
    expect(DEFAULT_MASK_LAYOUT.scale).toBeGreaterThan(MASK_SCALE_MIN)
  })
})

describe('положение маски под пальцем', () => {
  const rect = { left: 100, top: 50, width: 200, height: 200 }

  it('центр превью — центр кадра', () => {
    const point = framePointFromPointer({
      rect,
      frame: { width: 640, height: 480 },
      mirrored: false,
      clientX: 200,
      clientY: 150
    })

    expect(point.x).toBeCloseTo(0.5, 5)
    expect(point.y).toBeCloseTo(0.5, 5)
  })

  it('обрезка «cover» учтена: палец по центру кадра не уезжает по краям', () => {
    // Кадр 640×480 при квадратном превью: по бокам обрезано, поэтому палец у
    // левого края превью уже НЕ край кадра.
    const left = framePointFromPointer({
      rect,
      frame: { width: 640, height: 480 },
      mirrored: false,
      clientX: rect.left,
      clientY: 150
    })

    expect(left.x).toBeGreaterThan(0.1)
    expect(left.x).toBeLessThan(0.5)
  })

  it('зеркало передней камеры переворачивает координату', () => {
    const plain = framePointFromPointer({
      rect,
      frame: { width: 640, height: 480 },
      mirrored: false,
      clientX: 150,
      clientY: 150
    })
    const mirrored = framePointFromPointer({
      rect,
      frame: { width: 640, height: 480 },
      mirrored: true,
      clientX: 150,
      clientY: 150
    })

    expect(mirrored.x).toBeCloseTo(1 - plain.x, 5)
    expect(mirrored.y).toBeCloseTo(plain.y, 5)
  })

  it('нулевой размер превью не даёт NaN', () => {
    const point = framePointFromPointer({
      rect: { left: 0, top: 0, width: 0, height: 0 },
      frame: { width: 0, height: 0 },
      mirrored: false,
      clientX: 10,
      clientY: 10
    })

    expect(point).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('доступность эффектов', () => {
  it('без captureStream эффекты недоступны (старый браузер/встроенный WebView)', () => {
    expect(isVideoEffectsSupported({})).toBe(false)
    expect(isVideoEffectsSupported({ captureStream: () => null })).toBe(true)
    expect(isVideoEffectsSupported({ mozCaptureStream: () => null })).toBe(true)
  })
})

describe('рисование кадра и маски', () => {
  it('маска рисуется фигурами, а линзы очков вырезаются из кадра', () => {
    const ctx = fakeContext()
    const glasses = maskById('glasses')!

    drawMask(ctx as unknown as DrawContext, glasses, DEFAULT_MASK_LAYOUT, {
      width: 640,
      height: 480
    })

    expect(ctx.ellipse).toHaveBeenCalledTimes(4)
    // Оправа ×2, линзы ×2 и перемычка: каждая фигура закрашивается один раз.
    expect(ctx.calls.filter((call) => call === 'fill')).toHaveLength(5)
    // Две линзы — две «дырки»: иначе человек в очках получил бы чёрный кадр.
    expect(ctx.compositeOps.filter((value) => value === 'destination-out')).toHaveLength(2)
  })

  it('у маски без линз ничего не вырезается', () => {
    const ctx = fakeContext()

    drawMask(ctx as unknown as DrawContext, maskById('cat')!, DEFAULT_MASK_LAYOUT, {
      width: 640,
      height: 480
    })

    expect(ctx.compositeOps).toHaveLength(0)
    expect(ctx.calls).toContain('fill')
  })

  it('виньетка добавляет градиент по краям кадра', () => {
    const ctx = fakeContext()

    drawVideoFrame(
      ctx as unknown as Parameters<typeof drawVideoFrame>[0],
      {} as CanvasImageSource,
      videoEffectById('film'),
      { width: 640, height: 480 }
    )

    expect(ctx.calls.filter((call) => call === 'drawImage')).toHaveLength(1)
    expect(ctx.calls).toContain('addColorStop')
  })

  it('«мягкая кожа» рисует кадр дважды: резкий и размытый поверх', () => {
    const ctx = fakeContext()

    drawVideoFrame(
      ctx as unknown as Parameters<typeof drawVideoFrame>[0],
      {} as CanvasImageSource,
      videoEffectById('soft'),
      { width: 640, height: 480 }
    )

    expect(ctx.calls.filter((call) => call === 'drawImage')).toHaveLength(2)
  })
})
