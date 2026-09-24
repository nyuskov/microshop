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
/**
 * То же окно для неотвеченного звонка (он живёт ровно своё окно вызова).
 *
 * Больше, чем `CALL_REJOIN_WINDOW_MS`: звонок может звонить до 95 секунд, и
 * перезагрузка на восьмидесятой секунде — всё ещё тот же самый звонок.
 */
export const CALL_RINGING_REJOIN_WINDOW_MS = 95_000
/** Как часто отмечаем идущий звонок «живым» (секунды, кратные этому числу). */
export const CALL_TOUCH_EVERY_SECONDS = 5
/** Сколько ждём пересогласования от собеседника, прежде чем считать звонок сброшенным. */
/*
 * 30 секунд, а не 12: после перезагрузки страница поднимается заново — сессия,
 * список чатов, сигнальный канал и захват камеры. На телефоне это легко занимает
 * 10–20 секунд, а собеседник в это время только замечает обрыв (его ICE переходит
 * в `disconnected` не сразу) и лишь потом шлёт предложение. С прежними 12
 * секундами звонок завершался ровно в тот момент, когда собеседник собирался
 * пересогласоваться, — владелец видел это как «при перезагрузке звонок срывается».
 */
export const CALL_REJOIN_TIMEOUT_MS = 30_000
/**
 * Сколько ждём предложение от собеседника, прежде чем… предложить самим.
 *
 * Пересогласование начинает ОДНА сторона (младший по id — то же правило, что в
 * групповом «mesh»): иначе обе стороны пошлют предложение одновременно, каждое
 * не применится («glare»), и звонок сорвётся уже навсегда. Тот, кому инициатива
 * не досталась, выжидает это время и не трогает ICE сам.
 */
export const PEER_REJOIN_WINDOW_MS = 30_000
/** Пауза перед своим предложением: собеседнику нужно время применить наше `call-rejoin`. */
export const REJOIN_OFFER_DELAY_MS = 1500

/* --------- Уход страницы (закрытие или перезагрузка) --------- */

/**
 * Где страница помечает, что уходит из звонка.
 *
 * Ключ читает `public/theme-boot.js` — до загрузки приложения, чтобы успеть
 * сказать серверу «я вернулась» (см. `rememberCallLeave`).
 */
const CALL_LEAVE_KEY = 'pismo_call_leaving'

export interface StoredCall {
  callId: string
  peerId: number
  kind: CallKind
  /** Групповой звонок: после перезагрузки захват медиа берём «групповой». */
  isGroup?: boolean
  /** Когда звонок стал активным — чтобы вернуть честный счётчик времени. */
  startedAt: number
  /**
   * Ещё не отвеченный звонок: `outgoing` — звоним мы, `incoming` — звонят нам.
   *
   * Без этого перезагрузка во время ВЫЗОВА теряла его целиком (владелец
   * 24.09.2026: «проверь при созванивании»): памятка писалась только для
   * идущего разговора, а собеседник всё это время продолжал звонить в тишину.
   */
  ringing?: 'outgoing' | 'incoming'
  /**
   * SDP собеседника для входящего звонка.
   *
   * После перезагрузки отвечать было бы нечем: предложение приходило в прежнюю
   * страницу. Пока пользователь не ответил, оно лежит в памятке, а свежее
   * предложение приходит от собеседника в ответ на `call-rejoin`.
   */
  offerSdp?: string
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

/**
 * Помечает уход страницы из звонка (закрытие или перезагрузка).
 *
 * Пишем в sessionStorage, а не в localStorage: перезагрузка сохраняет эту
 * запись, а закрытая вкладка — нет. По ней `theme-boot.js` отменит уход, если
 * страница на самом деле вернулась (перезагрузка выглядит точно как закрытие).
 *
 * ``cancelUrl`` кладём в саму запись: boot-скрипт статический и не знает, на
 * каком origin живёт API.
 */
export function rememberCallLeave(callId: string, cancelUrl: string): void {
  try {
    window.sessionStorage.setItem(
      CALL_LEAVE_KEY,
      JSON.stringify({ callId, cancelUrl, at: Date.now() })
    )
  } catch {
    /* приватный режим — уход отменит само подключение сигнального канала */
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
    // Неотвеченный звонок живёт не дольше собственного окна вызова: зовущий
    // сдаётся через `RING_OUT_TIMEOUT_MS`, принимающий — через
    // `INCOMING_STALE_TIMEOUT_MS`. Поднимать его позже этого срока нечего.
    // (Имя переменной не `window` — оно заслонило бы глобальный `window`.)
    const rejoinWindow = parsed.ringing ? CALL_RINGING_REJOIN_WINDOW_MS : CALL_REJOIN_WINDOW_MS
    if (Date.now() - touched > rejoinWindow) return null
    return parsed
  } catch {
    return null
  }
}
