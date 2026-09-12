import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Стражи вёрстки каркаса для экранной клавиатуры.
 *
 * Баг: при открытии клавиатуры поле ввода уезжало под неё. Причина оказалась не
 * в нашей вёрстке, а в Quasar: `QLayout` вешает на каркас инлайновый
 * `min-height: window.innerHeight` — он равняется окну, а не визуальной области,
 * и перебивал высоту из `--ms-vv-h`.
 *
 * Проверки статические (jsdom не считает раскладку), поэтому читаем исходники:
 * важно, чтобы строка `min-height: 0 !important` и подключение
 * `useVisualViewport` не потерялись при рефакторинге.
 */

const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const app = readFileSync('src/App.vue', 'utf8')
const style = readFileSync('src/assets/style.css', 'utf8')

describe('каркас и экранная клавиатура', () => {
  it('гасит инлайновый min-height от Quasar', () => {
    const shell = messenger.slice(messenger.indexOf('.messenger-shell {'))
    expect(shell).toContain('min-height: 0 !important')
    // Причина зафиксирована рядом с правилом.
    expect(shell).toContain('min-height: window.innerHeight')
  })

  it('высота каркаса берётся из визуальной области', () => {
    const shell = messenger.slice(messenger.indexOf('.messenger-shell {'))
    expect(shell).toContain('height: var(--ms-vv-h, 100%)')
    expect(shell).toContain('top: var(--ms-vv-top, 0)')
    expect(style).toContain('height: var(--ms-vv-h, 100%)')
  })

  it('композабл visualViewport подключён в корне приложения', () => {
    expect(app).toContain("import { useVisualViewport } from '@/composables/useVisualViewport'")
    expect(app).toContain('useVisualViewport()')
  })
})
