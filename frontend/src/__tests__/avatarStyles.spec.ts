import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Аватар обязан иметь размер.
 *
 * Классы `avatar` / `avatar-img` повторяются в десятке компонентов, и каждый
 * задавал размер сам — а где правило забыли, картинка рисовалась в НАТУРАЛЬНУЮ
 * величину. Живой случай (19.09.2026): в комментариях к посту канала аватар
 * 512px сжимал текст комментария в столбик по одной букве.
 *
 * База живёт в `assets/appearance.css` (`.avatar` / `.avatar-img`), а компонент
 * со своим размером её перекрывает — scoped-правило весит больше. Тест следит
 * за тем, чтобы у КАЖДОГО компонента с аватаром в разметке был размер: свой или
 * из базы.
 */

const SRC = 'src'
const appearance = readFileSync(path.join(SRC, 'assets', 'appearance.css'), 'utf8')

/** Содержимое <style> блоков файла. */
const stylesOf = (source) =>
  [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')

/** Тело правила `.avatar { … }` (или null, если правила нет). */
const ruleBody = (css, selector) => {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) return null
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open, close)
}

const vueFiles = readdirSync(SRC, { recursive: true })
  .map((entry) => String(entry))
  .filter((entry) => entry.endsWith('.vue') && !entry.includes('__tests__'))
  .sort()

describe('аватар: размер задан везде', () => {
  it('в общем слое есть база: круг 40px и вписанная картинка', () => {
    const base = ruleBody(appearance, '.avatar')
    expect(base).not.toBeNull()
    expect(base).toContain('width: 40px;')
    expect(base).toContain('height: 40px;')
    expect(base).toContain('overflow: hidden;')
    expect(base).toContain('border-radius: var(--ms-radius-pill);')

    const img = ruleBody(appearance, '.avatar-img')
    expect(img).not.toBeNull()
    expect(img).toContain('width: 100%;')
    expect(img).toContain('height: 100%;')
    expect(img).toContain('object-fit: cover;')
  })

  it('каждый компонент с аватаром в разметке имеет размер — свой или из базы', () => {
    const base = ruleBody(appearance, '.avatar')
    const hasBase = Boolean(base && base.includes('width:'))

    const безРазмера = []
    for (const file of vueFiles) {
      const source = readFileSync(path.join(SRC, file), 'utf8')
      const usesAvatar = /class="[^"]*\bavatar\b/.test(source) || source.includes('avatar-img')
      if (!usesAvatar) continue

      const styles = stylesOf(source)
      const hasOwnRule =
        /(^|[\s,>])\.avatar\s*\{/m.test(styles) || /(^|[\s,>])\.avatar-img\s*\{/m.test(styles)
      if (!hasOwnRule && !hasBase) безРазмера.push(file)
    }

    // Если базу удалят, здесь окажутся все такие компоненты (например
    // `channels/ChannelCommentsDialog.vue`) — тогда картинка снова вырастет.
    expect(безРазмера).toEqual([])
  })
})
