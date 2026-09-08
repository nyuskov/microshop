/**
 * Регистрация service worker и механика «новая версия доступна».
 *
 * Показываем баннер обновления, когда браузер нашёл новый worker (новый деплой),
 * и по нажатию «Обновить» активируем его (SKIP_WAITING), после чего
 * controllerchange в приложении перезагружает страницу на свежую версию.
 */

let registration: ServiceWorkerRegistration | null = null

/** Регистрирует SW и вызывает onUpdate, когда доступна новая версия. */
export function registerServiceWorker(onUpdate: () => void): void {
  // Service worker — только в production-сборке (в dev мешает HMR).
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        registration = reg
        // Уже есть ожидающая новая версия (например, апдейт пришёл, пока страница была открыта).
        if (reg.waiting && navigator.serviceWorker.controller) {
          onUpdate()
          return
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            // installed + есть активный контроллер = новая версия готова к активации.
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdate()
            }
          })
        })
      })
      .catch(() => {
        /* SW недоступен (например, http в проде) — молча пропускаем. */
      })
  })
}

/** Активирует новую версию (перезагрузку выполняет controllerchange-слушатель). */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!registration) return
  let worker: ServiceWorker | null = registration.waiting
  if (!worker) {
    // На всякий случай проверяем обновление — могло прийти, пока ждали.
    await registration.update()
    worker = registration.waiting
  }
  if (worker) {
    worker.postMessage({ type: 'SKIP_WAITING' })
  }
}
