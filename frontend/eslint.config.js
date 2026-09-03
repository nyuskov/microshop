import js from '@eslint/js'
import vueTs from '@vue/eslint-config-typescript'
import vuePrettier from '@vue/eslint-config-prettier'
import globals from 'globals'

// Объединяем конфигурации
export default [
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
