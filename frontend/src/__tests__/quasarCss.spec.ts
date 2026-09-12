/**
 * Страховка от «забыли стили Quasar для компонента».
 *
 * Стили Quasar подключаются подмножеством (`src/assets/quasar-subset.sass`), а не
 * целиком (`quasar/dist/quasar.css`, 206 КБ). Плата за это та же, что у точечной
 * регистрации компонентов: забытый импорт — не ошибка сборки, а компонент без
 * стилей (кнопка без фона, поле без рамки). Тест сверяет разметку со списком
 * импортов в файле стилей и падает, если чего-то не хватает.
 *
 * Плюс проверяем мини-палитру: Quasar вешает классы `text-<color>`/`bg-<color>`
 * по пропу `color="…"`, и если цвет не входит в мини-палитру, элемент останется
 * без цвета.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.resolve(import.meta.dirname, '..')
const STYLES_PATH = path.join(SRC, 'assets', 'quasar-subset.sass')

/**
 * Компонент в разметке → sass-файлы Quasar, которые обязаны быть импортированы.
 * Пути указаны как в `quasar/src/css/index.sass`.
 */
const COMPONENT_STYLES: Readonly<Record<string, readonly string[]>> = {
  'q-icon': ['components/icon/QIcon.sass'],
  'q-btn': ['components/btn/QBtn.sass'],
  'q-card': ['components/card/QCard.sass'],
  'q-card-section': ['components/card/QCard.sass'],
  'q-card-actions': ['components/card/QCard.sass'],
  'q-dialog': ['components/dialog/QDialog.sass'],
  // У QLayout/QDrawer/QPageContainer один файл стилей на всех:
  // отдельных sass у drawer и page-container в пакете нет.
  'q-layout': ['components/layout/QLayout.sass'],
  'q-drawer': ['components/layout/QLayout.sass'],
  'q-page-container': ['components/layout/QLayout.sass'],
  'q-input': ['components/input/QInput.sass', 'components/field/QField.sass'],
  'q-radio': ['components/radio/QRadio.sass', 'components/checkbox/QCheckbox.sass'],
  'q-toggle': ['components/toggle/QToggle.sass', 'components/checkbox/QCheckbox.sass'],
  'q-separator': ['components/separator/QSeparator.sass'],
  'q-space': ['components/space/QSpace.sass'],
  'q-spinner': ['components/spinner/QSpinner.sass']
}

/** Цвета мини-палитры (`text-*`/`bg-*`), см. `config.brand` в main.ts. */
const PALETTE = [
  'primary',
  'secondary',
  'accent',
  'positive',
  'negative',
  'info',
  'warning',
  'white'
]

function collectVueFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...collectVueFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

/** Теги `<q-*>` в шаблонах. */
function usedComponents(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of collectVueFiles(SRC)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/<(q-[a-z-]+)[\s/>]/g)) {
      const name = match[1]
      if (!found.has(name)) found.set(name, path.relative(SRC, file))
    }
  }
  return found
}

describe('Стили Quasar подключены подмножеством', () => {
  const styles = readFileSync(STYLES_PATH, 'utf8')

  it('для каждого используемого компонента подключены его стили', () => {
    const missing: string[] = []
    for (const [name, where] of usedComponents()) {
      const paths = COMPONENT_STYLES[name]
      if (paths === undefined) {
        // Новый компонент: дописать и его, и импорт стилей.
        missing.push(
          `${name} (${where}) — нет в таблице теста, добавьте стили в quasar-subset.sass`
        )
        continue
      }
      for (const p of paths) {
        if (!styles.includes(`'quasar/src/${p}'`))
          missing.push(`${name} (${where}) — нет импорта ${p}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('в подмножестве нет стилей неиспользуемых компонентов', () => {
    const needed = new Set(Object.values(COMPONENT_STYLES).flat())
    const extra = [
      ...styles.matchAll(/@import 'quasar\/src\/(components\/[^']+|composables\/[^']+)'/g)
    ]
      .map((m) => m[1])
      .filter((p) => !needed.has(p) && p !== 'composables/private.use-panel/use-panel.sass')
    expect(extra).toEqual([])
  })

  it('все цвета из пропов `color="…"` есть в мини-палитре', () => {
    const unknown = new Set<string>()
    for (const file of collectVueFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      // Только статические значения: `:color="expr"` посчитать нельзя.
      for (const match of source.matchAll(/(?<!:)\bcolor="([a-z-]+)"/g)) {
        if (!PALETTE.includes(match[1])) unknown.add(`${match[1]} (${path.relative(SRC, file)})`)
      }
    }
    expect([...unknown]).toEqual([])
  })
})
