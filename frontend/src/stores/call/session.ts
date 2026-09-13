import type { CallKind } from './types'

/* --------- Идущий звонок переживает перезагрузку страницы --------- */

/**
 * Где лежит «памятка» об идущем звонке.
 *
 * sessionStorage, а не localStorage: запись нужна только этой вкладке и только
 * до перезагрузки. Если приложение закрыли, звонок давно завершён — поднимать
 * его при следующем запуске нельзя.
 */
const CALL_SESSION_KEY = 'pismo_call_session'
/** Сколько считаем «мы только что перезагрузились» (дольше — это уже другой случай). */
export const CALL_REJOIN_WINDOW_MS = 60_000
/** Как часто отмечаем идущий звонок «живым» (секунды, кратные этому числу). */
export const CALL_TOUCH_EVERY_SECONDS = 5
/** Сколько ждём пересогласования от собеседника, прежде чем считать звонок сброшенным. */
export const CALL_REJOIN_TIMEOUT_MS = 12_000

export interface StoredCall {
  callId: string
  peerId: number
  kind: CallKind
  /** Когда звонок стал активным — чтобы вернуть честный счётчик времени. */
  startedAt: number
  /**
   * Когда мы в последний раз видели звонок живым.
   *
   * Именно по этому полю решаем, восстанавливать ли звонок: разговор мог идти
   * час, и это не повод считать запись устаревшей — важно, чтобы после
   * перезагрузки звонок был ещё «свежим».
   */
  touchedAt: number
}

export function rememberActiveCall(call: StoredCall): void {
  try {
    window.sessionStorage.setItem(CALL_SESSION_KEY, JSON.stringify(call))
  } catch {
    /* приватный режим — просто не сможем восстановить звонок */
  }
}

export function forgetActiveCall(): void {
  try {
    window.sessionStorage.removeItem(CALL_SESSION_KEY)
  } catch {
    /* нечего чистить */
  }
}

/** Звонок, который шёл до перезагрузки страницы (или null). */
export function callAfterReload(): StoredCall | null {
  try {
    const raw = window.sessionStorage.getItem(CALL_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCall
    if (!parsed?.callId || !parsed.peerId) return null
    const touched = parsed.touchedAt ?? parsed.startedAt ?? 0
    if (Date.now() - touched > CALL_REJOIN_WINDOW_MS) return null
    return parsed
  } catch {
    return null
  }
}
