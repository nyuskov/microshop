import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { t } from '@/i18n'
import { useAuthStore } from './stores/auth' // Import the auth store

// Quasar (UI framework) + Material Symbols Rounded — импортируем до наших
// стилей, чтобы переопределения из style.css/appearance.css имели приоритет.
import { Quasar, Dialog, Notify } from 'quasar'
import quasarRuLang from 'quasar/lang/ru'
// Стили Quasar — только для используемых компонентов (см. файл):
// вместо `quasar/dist/quasar.css` целиком (206 КБ) — 15 компонентов.
import './assets/quasar-subset.sass'

// Иконки: свой @font-face на урезанный Material Symbols Rounded
// (полный набор 5 МБ — см. frontend/scripts/build-icons-font.py).
import './assets/icons.css'

// Иконки, которых нет в Lucide, — нарисованы вручную (маска из своего SVG).
// Сразу после icons.css: правила должны идти после стилей Quasar и шрифтовых
// иконок — см. DRAWN_GLYPHS в src/utils/icons.ts.
import './assets/icons-drawn.css'

// Основной шрифт Roboto — локально (кириллица + латиница):
// frontend/scripts/fetch_font.py скачивает наборы и собирает fonts.css.
import './assets/fonts.css'

// Import global styles
import './assets/style.css'
import './assets/appearance.css'
// Общий вид «списков строк» (список чатов, поиск, контакты): область — .ms-rows.
import './assets/rows.css'
// Общий язык всплывающих окон для самодельных слоёв (.ms-overlay*):
// у dialogs Quasar то же самое живет в quasar.css.
import './assets/overlays.css'
import './assets/quasar.css'
import './assets/a11y.css'
// Import the new theme store
import { useThemeStore } from './stores/theme'
import { installAvatarFallback } from './utils/avatarFallback'
import { watchInstallPrompt } from './services/installPrompt'
import { migrateLegacyStorage } from './utils/storage'
import { reportFatalError } from './utils/fatalError'

const app = createApp(App)

// Фатальные ошибки (рендер компонента, ошибка в обработчике) показываем
// понятным экраном с перезагрузкой вместо белого экрана — см. FatalErrorScreen.
// Ошибки запросов сюда не попадают: их разбирает интерфейс.
app.config.errorHandler = (error) => {
  console.error(t('Фатальная ошибка приложения:'), error)
  reportFatalError(error)
}
window.addEventListener('error', (event) => {
  if (event.error) reportFatalError(event.error)
})

// Битые миниатюры аватаров (файла нет, а ссылка в БД осталась) подменяем на
// оригинал — иначе человек видит пустое место вместо аватара.
installAvatarFallback()

// Установку приложения Chrome предлагает событием `beforeinstallprompt`, и оно
// приходит ОДИН раз за загрузку страницы. Слушателя вешаем здесь, а не в разделе
// «Устройство» (он ленивый и загрузился бы позже события) — см. installPrompt.ts.
watchInstallPrompt()

app.use(createPinia())
app.use(router)

app.use(Quasar, {
  lang: quasarRuLang,
  plugins: {
    Dialog,
    Notify
  },
  config: {
    brand: {
      primary: '#2ea25e',
      secondary: '#6d7c8c',
      accent: '#2f7fd1',
      dark: '#171e26',
      positive: '#2ea25e',
      negative: '#d64545',
      info: '#3aa6e0',
      warning: '#ee7f1d',
      // Нужен для классов `text-white`/`bg-white`, которые Quasar вешает на
      // заполненные кнопки (`bg-<color> text-white`). Мини-палитра стилей
      // Quasar берёт цвета из этих же переменных — хардкода нет.
      white: '#ffffff'
    },
    notify: {
      position: 'top',
      timeout: 2500,
      // Крестик (Quasar добавляет действие «Закрыть»): тост живёт 2,5 с, и до
      // этого его можно было только переждать — прочитать повторно или убрать
      // с дороги нечем. Свайпа в Quasar Notify нет — закрываем кнопкой.
      closeBtn: true
    },
    ripple: true
  }
})

// Компоненты и директивы Quasar регистрируем точечно (см. src/quasar.ts):
// полный `import * as …` тянул в бандл всю библиотеку — 553 КБ (177 КБ gzip)
// ради полутора десятков компонентов.
import { registerQuasar } from './quasar'
registerQuasar(app)

// Переносим данные прежнего названия приложения (microshop_* → pismo_*)
// ДО обращения к настройкам/черновикам/ключам E2EE — иначе пользователь потерял бы их.
migrateLegacyStorage()

// Initialize the theme and sidebar state after app creation
const themeStore = useThemeStore()
themeStore.initializeTheme()
themeStore.initializeSidebarState() // Initialize sidebar state

// Initialize the auth store to check for existing tokens
const authStore = useAuthStore()
authStore.initializeApp() // Call initializeApp to check token validity

app.mount('#app')
