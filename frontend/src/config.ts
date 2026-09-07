/**
 * Централизованная конфигурация адресов бэкенда.
 *
 * Раньше адрес `https://<host>:8000` дублировался в auth-store, api.ts,
 * chatService (mediaUrl) и stores/call.ts. Теперь он задаётся в одном месте.
 *
 * Можно переопределить через переменную окружения VITE_API_ORIGIN
 * (без завершающего слэша), например:
 *   - http://localhost:8080 — через nginx;
 *   - пустая строка + Vite-proxy — если фронт ходит на тот же origin.
 * По умолчанию: https://<host>:8000 (как раньше).
 */

function resolveOrigin(): string {
  const fromEnv = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? ''
  const trimmed = fromEnv.trim().replace(/\/+$/, '')
  if (trimmed) return trimmed
  return `${window.location.protocol}//${window.location.hostname}:8000`
}

/** Origin бэкенда, например `https://localhost:8000`. */
export const API_ORIGIN = resolveOrigin()

/** Базовый URL API, например `https://localhost:8000/api/v1`. */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`

/** Origin для WebSocket (схема ws/wss вместо http/https). */
export const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws')

/**
 * Превращает путь (`/media/...`) или относительный путь в абсолютный URL.
 * Абсолютные URL (http/https) возвращаются как есть.
 */
export function mediaUrl(path: string): string {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}
