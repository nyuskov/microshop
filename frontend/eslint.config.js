import js from '@eslint/js'
import vueTs from '@vue/eslint-config-typescript'
import vuePrettier from '@vue/eslint-config-prettier'

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
    }
  }
]
