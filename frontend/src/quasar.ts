/**
 * Явная регистрация компонентов Quasar.
 *
 * Зачем не `import * as QuasarExports from 'quasar'` (как было раньше): такой
 * импорт затягивает в бандл ВСЮ библиотеку — в сборке это был чанк 553 КБ
 * (177 КБ gzip), тогда как реально используется полтора десятка компонентов.
 * Пакет Quasar помечен как tree-shakeable (`sideEffects` без JS), поэтому
 * именованный импорт позволяет Rollup выбросить всё лишнее.
 *
 * ГРАБЛЯ: не зарегистрированный компонент в шаблоне — это не ошибка сборки, а
 * пустое место в интерфейсе (Vue молча отрисует неизвестный тег). От этого
 * защищает `src/__tests__/quasarComponents.spec.ts`: он сканирует все `<q-*>`
 * в шаблонах и падает, если компонента нет в списке ниже. Добавили в разметку
 * новый `q-что-то` — добавьте его сюда.
 *
 * Где что лежит: стили Quasar по-прежнему подключаются целиком
 * (`quasar/dist/quasar.css`), это отдельный вопрос и к JS-бандлу отношения не
 * имеет.
 */

import type { App } from 'vue'
import {
  ClosePopup,
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QCheckbox,
  QDialog,
  QDrawer,
  QIcon,
  QInput,
  QLayout,
  QMenu,
  QPageContainer,
  QRadio,
  QSeparator,
  QSpace,
  QSpinner,
  QToggle
} from 'quasar'

/** Компонент в разметке (`<q-icon>`) → имя для регистрации (`QIcon`). */
export const QUASAR_COMPONENTS: Readonly<Record<string, unknown>> = {
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QCheckbox,
  QDialog,
  QDrawer,
  QIcon,
  QInput,
  QLayout,
  QMenu,
  QPageContainer,
  QRadio,
  QSeparator,
  QSpace,
  QSpinner,
  QToggle
}

/**
 * Директивы. Ключ — то, что написано в разметке после `v-`
 * (`v-close-popup` → `close-popup`), а не `.name` из библиотеки: так связь
 * очевидна и не зависит от внутренностей Quasar.
 */
export const QUASAR_DIRECTIVES: Readonly<Record<string, unknown>> = {
  'close-popup': ClosePopup
}

/** Регистрирует компоненты и директивы Quasar глобально. */
export function registerQuasar(app: App): void {
  for (const [name, component] of Object.entries(QUASAR_COMPONENTS)) {
    app.component(name, component as never)
  }
  for (const [name, directive] of Object.entries(QUASAR_DIRECTIVES)) {
    app.directive(name, directive as never)
  }
}
