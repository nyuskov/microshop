// Конфигурация ТОЛЬКО для стража доступности (scripts/check-a11y.mjs).
//
// Правила плагина включены как ошибки, но известный долг записан в
// scripts/a11y-baseline.json: проверка падает только на НОВЫХ нарушениях — как
// остальные стилевые стражи (см. docs/checks.md). В основной eslint.config.js
// правила не подключены, иначе `eslint src` и редактор показывали бы сотню
// красных строк на существующем коде.
import base from './eslint.config.js'
import vueA11y from 'eslint-plugin-vuejs-accessibility'

export default [
  ...base,
  {
    files: ['**/*.vue'],
    plugins: { 'vuejs-accessibility': vueA11y },
    rules: vueA11y.configs['flat/recommended'][1].rules
  }
]
