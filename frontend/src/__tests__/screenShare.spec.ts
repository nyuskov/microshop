import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { screenShareNotice, screenShareSupport } from '@/stores/call'

/**
 * Причины недоступности показа экрана: раньше на любую из них интерфейс говорил
 * «Браузер не поддерживает демонстрацию экрана» — и это сбивало с толку, когда на
 * самом деле открыт http или телефон.
 */
const originalUserAgent = navigator.userAgent

function stubEnv(options: {
  ua?: string
  secure?: boolean
  mediaDevices?: unknown
  getDisplayMedia?: unknown
}): void {
  vi.stubGlobal('window', { isSecureContext: options.secure ?? true })
  const mediaDevices =
    options.mediaDevices === undefined
      ? options.getDisplayMedia === undefined
        ? undefined
        : { getDisplayMedia: options.getDisplayMedia }
      : options.mediaDevices
  vi.stubGlobal('navigator', { userAgent: options.ua ?? originalUserAgent, mediaDevices })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('screenShareSupport', () => {
  it('в десктопном браузере с API показывает «ok»', () => {
    stubEnv({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0', getDisplayMedia: () => {} })
    expect(screenShareSupport()).toBe('ok')
  })

  it('по http (незащищённый контекст) сообщает про HTTPS', () => {
    stubEnv({ secure: false, getDisplayMedia: () => {} })
    expect(screenShareSupport()).toBe('insecure')
    expect(screenShareNotice('insecure')).toContain('HTTPS')
  })

  it('без mediaDevices (http в старом браузере) тоже про HTTPS', () => {
    stubEnv({ secure: true, mediaDevices: undefined })
    expect(screenShareSupport()).toBe('insecure')
  })

  it('на телефоне без API говорит, что нужен компьютер', () => {
    // mediaDevices есть (HTTPS), но захвата экрана в мобильной сборке нет.
    stubEnv({
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0 Mobile',
      mediaDevices: {}
    })
    expect(screenShareSupport()).toBe('mobile')
    expect(screenShareNotice('mobile')).toContain('компьютера')
  })

  it('в WebView (Android-приложение) — тот же ответ про компьютер', () => {
    stubEnv({ ua: 'Mozilla/5.0 (Linux; Android 13; PismoApp/1.0) wv', mediaDevices: {} })
    expect(screenShareSupport()).toBe('mobile')
  })

  it('на десктопе без API — именно «браузер не поддерживает»', () => {
    stubEnv({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0', mediaDevices: {} })
    expect(screenShareSupport()).toBe('unsupported')
    expect(screenShareNotice('unsupported')).toContain('не поддерживает')
  })

  it('во встроенном браузере редактора — «embedded», хотя API объявлен', () => {
    // Проверено живьём 19.09.2026: браузер VS Code (Electron 42) отдаёт
    // `getDisplayMedia` как функцию, а вызов отвечает «NotSupportedError: Not
    // supported». Кнопка показывалась, нажатие молчало — владелец решил, что
    // показ «пропал».
    stubEnv({
      ua: 'Mozilla/5.0 Chrome/148.0.7778.280 Electron/42.10.0 Code/1.138.0 Safari/537.36',
      getDisplayMedia: () => {}
    })
    expect(screenShareSupport()).toBe('embedded')
    expect(screenShareNotice('embedded')).toContain('обычном Chrome')
  })

  it('для «ok» текст пустой (показывать нечего)', () => {
    expect(screenShareNotice('ok')).toBe('')
  })
})

describe('показ экрана в звонке: видно и понятно', () => {
  const overlay = readFileSync('src/components/calls/CallOverlay.vue', 'utf8')
  const store = readFileSync('src/stores/call.ts', 'utf8')

  it('кнопка показа экрана — в самой панели, а не только в меню «Ещё»', () => {
    // Владелец: «Куда-то пропал показ экрана, в звонке его нет уже давно».
    // Причина была в меню «ещё» (03d0478): кнопка там есть, но её не находят.
    const controls = overlay.slice(overlay.indexOf('class="call-controls active-controls"'))
    const panel = controls.slice(0, controls.indexOf('call-popovers'))
    expect(panel).toContain('toggleScreenShare()')
    expect(panel).toContain("'stop_screen_share' : 'screen_share'")
  })

  it('виден ли показ — сказано словами, а не только подсветкой кнопки', () => {
    // «Работает ли он — не понятно»: подсвеченная кнопка не отвечает на вопрос
    // «идёт ли показ сейчас».
    expect(overlay).toContain('Вы показываете экран')
    expect(overlay).toContain('callStore.screenSharing')
    // Бейдж — в общем ряду бейджей, иначе он не появился бы вовсе.
    expect(overlay).toContain('    callStore.videoPausedForNetwork ||\n    callStore.screenSharing')
  })

  it('если показа нет, в меню сказано почему', () => {
    // Пункт, который просто исчезает, выглядит поломкой: причина из
    // `screenShareNotice` показывается строкой в меню.
    expect(overlay).toContain('const shareNotice = canShareScreen')
    expect(overlay).toContain('class="more-note"')
  })

  it('отказ показа не проглатывается молча', () => {
    // Раньше `catch` ставил `notice = ''`: человек нажимал кнопку и не знал,
    // сработало ли. Теперь называются и отмена выбора окна, и отказ браузера.
    expect(store).toContain('Показ экрана не начался: выбор окна отменён')
    expect(store).toContain('Браузер не дал показать экран')
    expect(store).toContain("const name = error instanceof Error ? error.name : ''")
  })

  it('смена камеры просит СТОРОНУ, а не устройство', () => {
    // На телефоне метки камер бесполезны («camera2 0, facing back»), а браузер
    // умеет выбирать камеру по `facingMode`.
    expect(store).toContain('async switchCameraFacing()')
    expect(store).toContain('facing: this.cameraFacing')
    expect(store).toContain("constraints.facingMode = { ideal: 'environment' }")
    // Выбор устройства отменяет выбор стороны — и наоборот.
    expect(store).toContain("this.selectedCamera = ''")
    expect(overlay).toContain('switchCameraFacing')
    expect(overlay).toContain('switch_camera')
  })

  it('своё превью зеркалится только у передней камеры', () => {
    // Раньше зеркалилось всегда: показ экрана и задняя камера отражались, и
    // текст в кадре читался справа налево.
    expect(overlay).toContain(':class="{ mirrored: mirrorLocal }"')
    expect(overlay).toContain("!callStore.screenSharing && callStore.cameraFacing === 'user'")
    expect(overlay).toContain('.local-video.mirrored')
  })
})
