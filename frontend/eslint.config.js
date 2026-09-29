import js from '@eslint/js'
import vueTs from '@vue/eslint-config-typescript'
import vuePrettier from '@vue/eslint-config-prettier'
import globals from 'globals'

// Объединяем конфигурации
export default [
  // Сгенерированный файл типов (src/types/generated.ts) не линтуем.
  { ignores: ['src/types/generated.ts'] },
  // Смоук-сценарии Playwright (`e2e/`) не линтуем: они не входят ни в один
  // tsconfig проекта, а `@playwright/test` намеренно не в зависимостях (иначе
  // пакет тянулся бы в сборку образа и в CI). Запуск — вручную, см. e2e/README.md.
  { ignores: ['e2e/**'] },
  // Собранная статика и сертификаты: `eslint .` (это делает `pnpm lint`) лез в
  // `dist/assets/*.js` — минифицированные бандлы на мегабайты, и линт висел
  // минутами на 100% CPU. ГРАБЛЯ (29.09.2026): гейт проекта линтит только `src`
  // (`make check-frontend`), а руками запущенный `eslint .` уходил в dist.
  { ignores: ['dist/**', 'certs_from_backend/**'] },
  js.configs.recommended,
  ...vueTs(),
  vuePrettier,
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-unused-vars': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }
      ] // Разрешить неиспользуемые переменные и аргументы с префиксом _
    },
    languageOptions: {
      globals: {
        ...globals.browser, // Добавляем глобальные переменные браузера (localStorage, window, console и т.д.)
        ...globals.node // Добавляем глобальные переменные Node.js (module, process и т.д.)
      }
    }
  },
  // Отдельная конфигурация для .pnpmfile.cjs
  {
    files: ['**/.pnpmfile.cjs'],
    languageOptions: {
      globals: {
        ...globals.node // Глобальные переменные Node.js для pnpmfile
        // Указываем, что переменная context может быть неиспользуемой, но не трогаем правила для нее тут
        // Лучше всего указать это в комментарии внутри самого файла или настроить правило более гибко.
      }
    },
    rules: {
      // Переопределяем правило для неиспользуемых переменных в этом файле, чтобы разрешить 'context'
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          args: 'none' // Игнорировать все аргументы функций в этом файле
        }
      ]
    }
  }
]
