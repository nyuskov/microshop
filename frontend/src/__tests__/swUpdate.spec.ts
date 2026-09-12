/**
 * Автообновление клиента: PWA на телефоне не должна сутками работать на старом
 * коде после выкатки.
 *
 * Симптом: правки выкатили, service worker обновился, а у человека в приложении
 * «ничего не изменилось» — страницу просто свернули и развернули, перезагрузки не
 * было. Теперь при смене управляющего воркера страница перезагружается сама, но
 * только когда это безопасно (звонок не идёт, человек не печатает).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetServiceWorkerUpdateWatch, watchServiceWorkerUpdate } from '@/services/swUpdate'

/** Заглушка ServiceWorkerContainer: умеет бросать `controllerchange`. */
class FakeServiceWorkerContainer extends EventTarget {
  constructor(public controller: object | null) {
    super()
  }
}

describe('автообновление после выкатки', () => {
  let reloads = 0

  beforeEach(() => {
    vi.useFakeTimers()
    reloads = 0
    resetServiceWorkerUpdateWatch()
    // jsdom не даёт перезагрузить страницу — считаем попытки.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: () => {
          reloads += 1
        }
      }
    })
  })

  afterEach(() => resetServiceWorkerUpdateWatch())

  it('первый запуск не перезагружает: страница и так свежая', () => {
    const container = new FakeServiceWorkerContainer(null)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container
    })

    watchServiceWorkerUpdate(() => true)
    container.dispatchEvent(new Event('controllerchange'))

    expect(reloads).toBe(0)
  })

  it('новая версия: перезагружаем, когда это безопасно', () => {
    const container = new FakeServiceWorkerContainer({})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container
    })

    watchServiceWorkerUpdate(() => true)
    container.dispatchEvent(new Event('controllerchange'))

    expect(reloads).toBe(1)
  })

  it('во время звонка не трогаем страницу и ждём удобного момента', async () => {
    const container = new FakeServiceWorkerContainer({})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container
    })

    // Сначала идёт звонок — перезагружать нельзя.
    let busy = true
    watchServiceWorkerUpdate(() => !busy)
    container.dispatchEvent(new Event('controllerchange'))
    expect(reloads).toBe(0)

    // Звонок закончился — обновляемся при следующей проверке.
    busy = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(reloads).toBe(1)
  })

  it('перезагружает один раз, а не в цикле', () => {
    const container = new FakeServiceWorkerContainer({})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container
    })

    watchServiceWorkerUpdate(() => true)
    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))

    expect(reloads).toBe(1)
  })
})
