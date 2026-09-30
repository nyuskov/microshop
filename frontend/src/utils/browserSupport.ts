/**
 * Что умеет ЭТО устройство и этот браузер.
 *
 * Самые частые «у меня не работает» — не про наше приложение, а про среду:
 * встроенный браузер VS Code (Electron) не имеет сервиса моделей Chrome, WebView
 * на телефоне — распознавания речи, мобильный браузер — показа экрана. Раньше это
 * выяснялось перепиской с владельцем: сначала жалоба, потом догадка, потом
 * просьба открыть консоль.
 *
 * Здесь только ДЕШЁВЫЕ проверки: наличие API и защищённый контекст. Модели не
 * скачиваем и никуда не ходим — состояние моделей выяснится при первом нажатии
 * (скачивание требует жеста человека, см. `utils/translation.ts`).
 */
import { screenShareNotice, screenShareSupport } from '@/stores/call/screenShare'
import { canOfferTranslation } from '@/utils/translation'
import { localSpeechModelInfo } from '@/utils/localSpeech'
import { speechEngineKind } from '@/utils/voiceRecognition'
import { t } from '@/i18n'

/** Итог одной проверки. `partial` — работает, но с оговоркой (см. `text`). */
export type DeviceSupportState = 'ok' | 'partial' | 'no'

export interface DeviceSupportItem {
  /** Устойчивый ключ для тестов и разметки. */
  key: 'calls' | 'screen' | 'push' | 'install' | 'speech' | 'translate' | 'playback'
  title: string
  state: DeviceSupportState
  /** Что это значит на этом устройстве — одной фразой. */
  text: string
  /** Что сделать, если не работает (пусто — делать нечего). */
  hint: string
}

/**
 * Встроенный браузер приложения или редактора.
 *
 * `Code/` — VS Code, `Electron` — оболочки на нём, `; wv)` — Android WebView,
 * `FBAN`/`FBAV`/`Instagram` — браузеры внутри приложений соцсетей: во всех них
 * часть API есть, а сервисов (модели Chrome, распознавание) нет.
 */
export const isEmbeddedBrowser = (agent?: string): boolean => {
  const ua = agent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  return /Electron|Code\/|;\s*wv\)|WebView|FBAN|FBAV|Instagram/i.test(ua)
}

/**
 * Какой именно браузер на Android.
 *
 * Нужен там, где браузеры РАЗЛИЧАЮТСЯ возможностями: установить приложение умеет
 * только Chrome, а Xiaomi (Redmi/POCO), Samsung, Яндекс и Huawei ставят лишь
 * ярлык либо ничего. Владелец: «на устройстве Redmi A3 не появляется как
 * приложение установить» — без этой проверки раздел советовал бы искать пункт
 * «Установить приложение» там, где его не бывает.
 */
export type AndroidBrowser =
  'chrome' | 'samsung' | 'miui' | 'huawei' | 'yandex' | 'opera' | 'uc' | 'firefox' | 'other'

export const androidBrowser = (agent?: string): AndroidBrowser => {
  const ua = agent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  // Свой бренд проверяем РАНЬШЕ `Chrome/`: у Xiaomi, Samsung и Яндекса рядом стоит
  // и Chrome — потому что внутри у них Chromium, но установка работает иначе.
  if (/MiuiBrowser|XiaoMi/i.test(ua)) return 'miui'
  if (/SamsungBrowser/i.test(ua)) return 'samsung'
  if (/HuaweiBrowser|Huawei/i.test(ua)) return 'huawei'
  if (/YaBrowser/i.test(ua)) return 'yandex'
  if (/OPR\/|Opera Mini|Opera Mobi/i.test(ua)) return 'opera'
  if (/UCBrowser|UCWEB/i.test(ua)) return 'uc'
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS/i.test(ua)) return 'chrome'
  return 'other'
}

/** Названия браузеров — это ИМЕНА: переводятся они только транслитерацией. */
const ANDROID_BROWSER_NAMES: Record<AndroidBrowser, string> = {
  chrome: 'Chrome',
  samsung: 'Samsung Internet',
  miui: 'Mi Browser',
  huawei: 'Huawei Browser',
  yandex: 'Яндекс.Браузер',
  opera: 'Opera',
  uc: 'UC Browser',
  firefox: 'Firefox',
  other: ''
}

/** Короткая строка про среду — идёт шапкой отчёта. */
export const browserLabel = (): string => {
  if (typeof navigator === 'undefined') return t('Неизвестное окружение')
  if (isEmbeddedBrowser()) return t('Встроенный браузер (не Chrome)')
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) {
    const name = ANDROID_BROWSER_NAMES[androidBrowser(ua)]
    return name ? t('{browser} на Android', { browser: name }) : t('Браузер на Android')
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return t('Браузер на iPhone или iPad')
  return t('Обычный браузер')
}

/** Есть ли защищённое соединение: без него нет ни звонков, ни push, ни микрофона. */
export const secureContext = (): boolean =>
  typeof window === 'undefined' ? true : window.isSecureContext !== false

/**
 * Открыто как УСТАНОВЛЕННОЕ приложение, а не как вкладка браузера.
 *
 * Два способа: `display-mode: standalone` (Android, десктоп) и собственный флаг
 * Safari (`navigator.standalone`) — в старых версиях iOS медиазапрос не отвечает.
 */
export const isInstalledApp = (): boolean => {
  if (typeof window === 'undefined') return false
  const standalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone || iosStandalone
}

/** Читает ли это устройство формат, в котором приложение записывает голосовые. */
export const voicePlaybackSupport = (): boolean => {
  if (typeof document === 'undefined') return false
  const probe = document.createElement('audio')
  if (typeof probe.canPlayType !== 'function') return false
  // Пишем через `MediaRecorder` в webm/Opus; на части устройств читается только
  // ogg/Opus или mp4 — тогда запись играется, но не там, где её записали.
  return (
    probe.canPlayType('audio/webm; codecs=opus') !== '' ||
    probe.canPlayType('audio/ogg; codecs=opus') !== '' ||
    probe.canPlayType('audio/mp4') !== ''
  )
}

const calls = (): DeviceSupportItem => {
  const hasPc = typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function'
  const hasMic = typeof navigator !== 'undefined' && !!navigator.mediaDevices
  if (!secureContext()) {
    return {
      key: 'calls',
      title: t('Звонки'),
      state: 'no',
      text: t('Нужно защищённое соединение (HTTPS)'),
      hint: t(
        'Откройте приложение по адресу https://… — по http браузер не даёт ни микрофон, ни камеру'
      )
    }
  }
  if (!hasPc || !hasMic) {
    return {
      key: 'calls',
      title: t('Звонки'),
      state: 'no',
      text: t('Браузер не умеет WebRTC'),
      hint: t('Позвонить можно из Chrome, Safari или Firefox на компьютере и телефоне')
    }
  }
  return {
    key: 'calls',
    title: t('Звонки'),
    state: 'ok',
    text: t('Звуковые и видеозвонки работают'),
    hint: ''
  }
}

const screen = (): DeviceSupportItem => {
  const support = screenShareSupport()
  if (support === 'ok') {
    return {
      key: 'screen',
      title: t('Показ экрана'),
      state: 'ok',
      text: t('Можно показать экран в звонке'),
      hint: ''
    }
  }
  const hints: Record<string, string> = {
    mobile: t('Включите показ экрана с компьютера — собеседник увидит его в том же звонке'),
    insecure: t('Откройте приложение по адресу https://… — по http браузер не даёт захват'),
    embedded: t('Это ограничение окружения, а не приложения: в обычном Chrome кнопка покажется')
  }
  return {
    key: 'screen',
    title: t('Показ экрана'),
    state: 'no',
    text: screenShareNotice(support),
    hint: hints[support] ?? t('Показывать экран умеют Chrome, Edge и Safari на компьютере')
  }
}

const push = (): DeviceSupportItem => {
  const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  const hasPush = typeof window !== 'undefined' && 'PushManager' in window
  const hasNotify = typeof window !== 'undefined' && 'Notification' in window
  if (!hasSw || !hasPush || !hasNotify) {
    return {
      key: 'push',
      title: t('Уведомления о сообщениях'),
      state: 'no',
      text: t('Браузер не умеет push-уведомления'),
      hint: isEmbeddedBrowser()
        ? t(
            'Во встроенном браузере push не приходят: откройте приложение в обычном Chrome и добавьте на главный экран'
          )
        : t(
            'Установите приложение на главный экран (Chrome: «Установить приложение») — тогда push будут приходить'
          )
    }
  }
  if (!secureContext()) {
    return {
      key: 'push',
      title: t('Уведомления о сообщениях'),
      state: 'no',
      text: t('Нужно защищённое соединение (HTTPS)'),
      hint: t('По http браузер не выдаёт разрешение на уведомления')
    }
  }
  const permission = typeof Notification === 'undefined' ? 'default' : Notification.permission
  if (permission === 'denied') {
    return {
      key: 'push',
      title: t('Уведомления о сообщениях'),
      state: 'no',
      text: t('Уведомления запрещены в настройках браузера'),
      hint: t(
        'Разрешите уведомления для этого сайта (значок замка в адресной строке) и обновите страницу'
      )
    }
  }
  if (permission === 'default') {
    return {
      key: 'push',
      title: t('Уведомления о сообщениях'),
      state: 'partial',
      text: t('Разрешение ещё не выдано'),
      hint: t('Включите уведомления в разделе «Уведомления» — браузер спросит разрешение')
    }
  }
  return {
    key: 'push',
    title: t('Уведомления о сообщениях'),
    state: 'ok',
    text: t('Уведомления разрешены'),
    hint: ''
  }
}

/**
 * Как поставить приложение на это устройство.
 *
 * Владелец: «в некоторых мобильных нельзя установить как приложение» — на iPhone
 * кнопки установки нет вообще (только «Поделиться» → «На экран "Домой"», и только
 * в Safari), а во встроенном браузере мессенджера установка недоступна. Раздел
 * обязан называть путь, иначе подсказка бесполезна.
 */
const install = (): DeviceSupportItem => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const ios = /iPhone|iPad|iPod/i.test(ua)
  if (isInstalledApp()) {
    return {
      key: 'install',
      title: t('Установка приложения'),
      state: 'ok',
      text: t('Открыто как приложение, а не как вкладка браузера'),
      hint: ''
    }
  }
  if (isEmbeddedBrowser()) {
    return {
      key: 'install',
      title: t('Установка приложения'),
      state: 'partial',
      text: t('Во встроенном браузере приложение установить нельзя'),
      hint: ios
        ? t(
            'Откройте адрес в Safari: кнопка «Поделиться» → «На экран "Домой"». В других браузерах на iPhone добавления на экран нет'
          )
        : t(
            'Откройте адрес в обычном Chrome: меню «⋮» → «Установить приложение» (или «Добавить на главный экран»)'
          )
    }
  }
  if (ios) {
    return {
      key: 'install',
      title: t('Установка приложения'),
      state: 'partial',
      text: t('На iPhone установка есть только в Safari'),
      hint: t(
        'Safari: кнопка «Поделиться» → «На экран "Домой"». В Chrome и других браузерах на iPhone такой возможности нет — это правило iOS, а не приложения'
      )
    }
  }
  if (/Android/i.test(ua)) {
    const browser = androidBrowser(ua)
    if (browser === 'chrome') {
      return {
        key: 'install',
        title: t('Установка приложения'),
        state: 'partial',
        text: t('Приложение ставится из Chrome'),
        hint: t(
          'Chrome: меню «⋮» → «Установить приложение». Если пункта нет — приложение уже установлено'
        )
      }
    }
    // Xiaomi (Redmi/POCO), Samsung, Huawei, Яндекс и прочие: установки приложения
    // у них нет или она даёт только ярлык. Не обещаем пункт, которого не бывает.
    return {
      key: 'install',
      title: t('Установка приложения'),
      state: 'partial',
      text: t('Этот браузер может не показать установку приложения'),
      hint: t(
        'Установка есть в Chrome: меню «⋮» → «Установить приложение». Если Chrome на телефоне нет — поставьте приложение Pismo из RuStore'
      )
    }
  }
  return {
    key: 'install',
    title: t('Установка приложения'),
    state: 'partial',
    text: t('Приложение можно поставить на главный экран'),
    hint: t(
      'Chrome: значок установки в адресной строке; Safari на компьютере: «Файл» → «Добавить в Dock». Если пункта нет — приложение уже установлено'
    )
  }
}

const speech = (): DeviceSupportItem => {
  const kind = speechEngineKind()
  if (kind === 'system') {
    return {
      key: 'speech',
      title: t('Расшифровка голосовых в текст'),
      state: 'ok',
      text: t('Распознаёт распознаватель устройства'),
      hint: ''
    }
  }
  if (kind === 'browser') {
    return {
      key: 'speech',
      title: t('Расшифровка голосовых в текст'),
      state: 'ok',
      text: t('Распознаёт Chrome: звук записи уходит в сервис браузера'),
      hint: ''
    }
  }
  if (kind === 'device') {
    // Телефон, Safari, Firefox: расшифровка есть, но нужна модель на устройстве.
    const model = localSpeechModelInfo()
    return {
      key: 'speech',
      title: t('Расшифровка голосовых в текст'),
      state: 'partial',
      text: t('Распознаём на устройстве моделью — она скачается один раз'),
      hint: t(
        'Модель «{title}» (~{size} МБ) скачается в браузер при первом нажатии значка расшифровки у записи; звук и текст при этом остаются на устройстве',
        { title: model.title, size: model.sizeMb }
      )
    }
  }
  return {
    key: 'speech',
    title: t('Расшифровка голосовых в текст'),
    state: 'no',
    text: t('У этого браузера нет распознавания речи'),
    hint: isEmbeddedBrowser()
      ? t(
          'Откройте Pismo в обычном браузере или в приложении: во встроенном браузере редактора модель распознавания не запускается'
        )
      : t('Нужен браузер с WebAssembly (Chrome, Firefox, Safari) либо приложение Pismo на Android')
  }
}

const translate = (): DeviceSupportItem => {
  // Спрашиваем то же, что и интерфейс (`canOfferTranslation`), а не наличие API:
  // в мобильном Chrome переводчик может быть объявлен, но мы его там не
  // предлагаем — и раздел не должен обещать то, чего кнопка не даст.
  if (canOfferTranslation()) {
    return {
      key: 'translate',
      title: t('Перевод сообщений'),
      state: 'partial',
      text: t('Переводит браузер устройства, модель скачается при первом переводе'),
      hint: t('Первые десятки мегабайт скачает браузер — текст при этом никуда не уходит')
    }
  }
  return {
    key: 'translate',
    title: t('Перевод сообщений'),
    state: 'no',
    text: t('У этого браузера нет встроенного переводчика'),
    hint: isEmbeddedBrowser()
      ? t(
          'Перевод есть только в обычном Chrome 138+ на компьютере: в приложении на Android и во встроенном браузере редактора сервиса моделей нет'
        )
      : t(
          'Нужен Chrome 138+ на компьютере: перевод идёт на устройстве, текст никуда не отправляется. В мобильных браузерах кнопки нет'
        )
  }
}

const playback = (): DeviceSupportItem => {
  if (voicePlaybackSupport()) {
    return {
      key: 'playback',
      title: t('Голосовые сообщения'),
      state: 'ok',
      // «Формат знаком», а не «записи играются»: `canPlayType` — только обещание
      // браузера, а живой файл может не прочитаться (проверено: Chromium
      // объявляет webm/Opus, а `decodeAudioData` на записи отвечает отказом).
      text: t('Формат записей (webm/Opus) устройству знаком'),
      hint: ''
    }
  }
  return {
    key: 'playback',
    title: t('Голосовые сообщения'),
    state: 'no',
    text: t('Устройство не умеет проигрывать формат записей (webm/Opus)'),
    hint: t(
      'Записи не послушать, но их можно расшифровать в текст значком ↳Т у записи — если расшифровка доступна'
    )
  }
}

/**
 * Полный отчёт по устройству — в порядке важности для человека.
 *
 * Функция чистая относительно состояния: ничего не меняет и ничего не качает,
 * поэтому её можно звать при каждом открытии раздела.
 */
export const deviceReport = (): DeviceSupportItem[] => [
  calls(),
  push(),
  install(),
  screen(),
  speech(),
  translate(),
  playback()
]

/** Сколько всего «работает» — для краткой строки в шапке раздела. */
export const supportSummary = (items: DeviceSupportItem[]): string => {
  const ok = items.filter((item) => item.state === 'ok').length
  const partial = items.filter((item) => item.state === 'partial').length
  const no = items.filter((item) => item.state === 'no').length
  const parts = [t('работает: {count}', { count: ok })]
  if (partial) parts.push(t('с оговоркой: {count}', { count: partial }))
  if (no) parts.push(t('недоступно: {count}', { count: no }))
  return parts.join(' · ')
}
