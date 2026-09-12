/**
 * Автообновление клиента после выкатки новой версии.
 *
 * На Android установленное приложение (PWA) живёт в памяти днями: на сервере уже
 * новый код, а страница продолжает работать на старом — правки «не приходят»,
 * хотя service worker давно обновился. Само приложение об этом не узнаёт, потому
 * что страница не перезагружается: её просто сворачивают и разворачивают.
 *
 * Поэтому: новый service worker взял управление (`controllerchange`) — значит, в
 * кэше лежит свежий фронтенд. Перезагружаем страницу сами, но только когда это
 * безопасно (звонок не идёт, экран звонка не открыт, человек не печатает) и один
 * раз за загрузку.
 */

/** Через сколько проверяем условия, если в момент обновления они не сложились. */
const RECHECK_MS = 20_000

let pending = false
let reloaded = false
let timer: number | null = null

/**
 * Следит за обновлением service worker'а и перезагружает страницу, когда можно.
 *
 * `canReload` вызывается перед перезагрузкой: правду о состоянии знает только
 * страница (идёт ли звонок, есть ли недописанное сообщение).
 */
export function watchServiceWorkerUpdate(canReload: () => boolean): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // Первый запуск: управляющего воркера ещё нет, а страница и так свежая —
  // перезагружать нечего (иначе был бы лишний круг при первом входе).
  if (!navigator.serviceWorker.controller) return

  const tryReload = () => {
    if (!pending || reloaded) return
    if (!canReload()) return
    reloaded = true
    pending = false
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pending = true
    // Если прямо сейчас нельзя (идёт звонок), дождёмся подходящего момента.
    tryReload()
    if (pending && timer === null) {
      timer = window.setInterval(() => {
        tryReload()
        if (!pending && timer !== null) {
          window.clearInterval(timer)
          timer = null
        }
      }, RECHECK_MS)
    }
  })
}

/** Только для тестов: сбрасывает состояние модуля между проверками. */
export function resetServiceWorkerUpdateWatch(): void {
  pending = false
  reloaded = false
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}
