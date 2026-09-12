/**
 * Бейдж на иконке приложения (Badging API).
 *
 * На установленном PWA (Android, Windows/macOS Chrome) рядом с иконкой видно
 * число непрочитанных — как в нативных мессенджерах. API поддержан не везде
 * (Safari/Firefox игнорируют вызовы), поэтому это необязательный «улучшайзер»:
 * любые ошибки и отсутствие API гасим молча.
 *
 * Точное число ставит приложение (оно знает непрочитанные по чатам). Когда
 * приложение закрыто и приходит push, service worker ставит «точку» — считать
 * непрочитанные там нечем (см. `public/sw.js`).
 */

/**
 * Часть интерфейса Badging API. Описываем её сами, а не через `Navigator`:
 * методов может не быть в браузере (тогда вызовы просто пропускаются).
 */
interface BadgingApi {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/** Показывает число непрочитанных на иконке (0 — снимает бейдж). */
export const setAppBadge = async (count: number): Promise<void> => {
  const api = navigator as unknown as BadgingApi
  try {
    if (count > 0) await api.setAppBadge?.(count)
    else await api.clearAppBadge?.()
  } catch {
    /* нет API или нет разрешения — бейдж просто не показываем */
  }
}
