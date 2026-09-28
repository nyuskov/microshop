import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'

import {
  EMOJI_EFFECTS,
  emojiEffectForText,
  playEmojiEffect,
  playEmojiEffectForText
} from '@/composables/useEmojiEffect'

/**
 * Эффект одного эмодзи: частицы при отправке ❤️/👍/🔥/🎉/⭐.
 *
 * Проверяем три вещи. Первая — когда эффект вообще нужен: только если ВСЁ
 * сообщение это один эмодзи, иначе частицы летали бы на «привет ❤️». Вторая —
 * помощник молча ничего не делает там, где анимации нет (jsdom, старый движок) и
 * где человек просил «уменьшить движение»: на экране не должно остаться ни
 * одного узла. Третья — сам полёт частиц и уборка слоя, для чего `animate`
 * подменяем счётчиком (в jsdom его нет вовсе).
 */
const source = (path: string): string => readFileSync(path, 'utf8')
const effect = source('src/composables/useEmojiEffect.ts')
const send = source('src/composables/useMessageSend.ts')
const appearance = source('src/assets/appearance.css')
const overlays = () => document.querySelectorAll('.emoji-effect')

const withReducedMotion = <T>(value: boolean, run: () => T): T => {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: value && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
  try {
    return run()
  } finally {
    window.matchMedia = original
  }
}

describe('эффект одного эмодзи: когда срабатывает', () => {
  it('узнаёт одиночный эмодзи, включая форму без селектора начертания', () => {
    expect(emojiEffectForText('❤️')).toBe('hearts')
    expect(emojiEffectForText('❤')).toBe('hearts')
    expect(emojiEffectForText('👍')).toBe('thumbs')
    expect(emojiEffectForText('🔥')).toBe('fire')
    expect(emojiEffectForText('  🎉 ')).toBe('party')
    expect(emojiEffectForText('⭐')).toBe('star')
  })

  it('на обычный текст не срабатывает', () => {
    expect(emojiEffectForText('привет ❤️')).toBeNull()
    expect(emojiEffectForText('❤️❤️')).toBeNull()
    expect(emojiEffectForText('ок')).toBeNull()
    expect(emojiEffectForText('')).toBeNull()
    expect(emojiEffectForText('   ')).toBeNull()
  })

  it('у каждого эффекта есть частицы и разброс', () => {
    for (const rule of Object.values(EMOJI_EFFECTS)) {
      expect(rule.glyphs.length).toBeGreaterThan(0)
      expect(rule.count).toBeGreaterThan(0)
      expect(rule.rise).toBeGreaterThan(0)
      expect(rule.rise).toBeLessThanOrEqual(1)
      expect(rule.spread).toBeGreaterThan(0)
      expect(rule.spread).toBeLessThanOrEqual(1)
      expect(rule.duration).toBeGreaterThan(0)
    }
  })
})

describe('эффект одного эмодзи: где его нет', () => {
  it('в jsdom (нет Element.animate) на экране не остаётся узлов', () => {
    expect(typeof document.createElement('span').animate).not.toBe('function')
    expect(() => playEmojiEffectForText('🔥')).not.toThrow()
    expect(overlays().length).toBe(0)
  })

  it('уважает «уменьшить движение»', () => {
    withReducedMotion(true, () => {
      expect(() => playEmojiEffect('hearts')).not.toThrow()
      expect(overlays().length).toBe(0)
    })
  })
})

describe('эффект одного эмодзи: полёт и уборка', () => {
  it('поднимает частицы, не ловит клики и уходит сам', async () => {
    type Animatable = { animate?: unknown }
    const proto = HTMLElement.prototype as unknown as Animatable
    const original = proto.animate
    const animate = vi.fn((_frames: Array<Record<string, unknown>>, _options?: unknown) => ({
      finished: Promise.resolve(),
      cancel: () => undefined
    }))
    proto.animate = animate
    try {
      playEmojiEffect('party')

      const layer = document.querySelector('.emoji-effect') as HTMLElement
      expect(layer).toBeTruthy()
      // Слой декоративный: он не должен перехватывать ни одного касания.
      expect(layer.style.pointerEvents).toBe('none')
      expect(layer.style.position).toBe('fixed')
      expect(layer.getAttribute('aria-hidden')).toBe('true')

      const particles = layer.querySelectorAll('span')
      expect(particles.length).toBe(EMOJI_EFFECTS.party.count)
      expect(animate).toHaveBeenCalledTimes(EMOJI_EFFECTS.party.count)
      // Частица уходит вверх (отрицательный сдвиг по Y) и тает.
      const keyframes = animate.mock.calls[0]?.[0] ?? []
      expect(String(keyframes[2]?.transform ?? '')).toContain('-')
      expect(keyframes[2]?.opacity).toBe(0)

      // Второй эффект подряд не наслаивается: слой остаётся один.
      playEmojiEffect('hearts')
      expect(overlays().length).toBe(1)

      await flushPromises()
      expect(overlays().length).toBe(0)
    } finally {
      proto.animate = original
      document.querySelectorAll('.emoji-effect').forEach((node) => node.remove())
    }
  })
})

describe('эффект одного эмодзи: связка с отправкой', () => {
  it('включается после успешной отправки текста и только тогда', () => {
    expect(send).toContain("from '@/composables/useEmojiEffect'")
    const call = send.indexOf('playEmojiEffectForText(text)')
    expect(call).toBeGreaterThan(-1)
    // Эффект — после доставки (нет сообщения — нет частиц) и до очистки поля.
    expect(send.indexOf('await deliverText(chatId, text,')).toBeLessThan(call)
    expect(call).toBeLessThan(send.indexOf("deps.composerText.value = ''", call))
  })

  it('слой объявлен токеном, а частицы — без ассетов и библиотек', () => {
    // Литеральный z-index в помощнике разошёлся бы с общей шкалой слоёв.
    expect(effect).toContain('var(--ms-z-effect')
    expect(appearance).toContain('--ms-z-effect:')
    // «Уменьшить движение» берём у уже готового помощника, а не пишем своё.
    expect(effect).toContain("from '@/composables/useFlyingEmoji'")
    // Готовых анимаций (Lottie/Rive) и внешних картинок у эффекта нет: только
    // эмодзи из системного шрифта, которые браузер рисует сам.
    expect(effect).not.toMatch(/https?:\/\//)
  })
})
