/**
 * Вибрация при входящем звонке (пока приложение открыто).
 *
 * Раньше телефон «дёргался» один раз в самом начале вызова, а дальше звонок шёл
 * только со звуком: одного толчка легко не заметить, особенно если телефон в
 * кармане, а звук приглушён (владелец, 24.09.2026: «добавить вибрации при
 * звонке или возможность хотя бы включить»). Теперь вибрация ПОВТОРЯЕТСЯ, пока
 * звонок звонит, и её можно выключить настройкой устройства.
 *
 * Почему в приложении и в уведомлении ритм один и тот же: это один и тот же
 * звонок, и человек не должен слышать два разных характера вибрации в
 * зависимости от того, свёрнуто приложение или открыто. Ритм уведомления живёт в
 * `services/pwa.ts` (`CALL_RING_VIBRATION`) и в `public/sw.js`; расхождение
 * ловит страж в тестах.
 *
 * Ограничения браузера, из-за которых вибрация может «молчать»:
 * - Vibration API есть только на Android (в Safari/iOS его нет вовсе);
 * - Chrome не даёт вибрировать, пока человек ни разу не коснулся страницы —
 *   поэтому после первого же жеста пробуем снова (см. `bindUnlockOnce`).
 */

/** Ключ настройки в localStorage: `'off'` — вибрация выключена. */
export const CALL_VIBRATION_KEY = 'pismo_call_vibration'

/** Ритм вибрации звонка (мс). Тот же, что у уведомления о звонке. */
export const CALL_VIBRATION_PATTERN = [400, 300, 400, 300, 400]

/**
 * Пауза между повторами ритма (мс).
 *
 * Чуть больше длины самого ритма (~1,9 с): толчки идут один за другим, но без
 * «непрерывной дрожи» — как у телефонного звонка.
 */
export const CALL_VIBRATION_REPEAT_MS = 2600

let repeatTimer: number | undefined
let unlockBound = false

/** Включена ли вибрация звонка на этом устройстве (по умолчанию — да). */
export function isCallVibrationEnabled(): boolean {
  try {
    return localStorage.getItem(CALL_VIBRATION_KEY) !== 'off'
  } catch {
    // Приватный режим: считаем настройку включённой — вибрация важнее галочки.
    return true
  }
}

/** Включает/выключает вибрацию звонка (сразу гасит текущую, если выключили). */
export function setCallVibrationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CALL_VIBRATION_KEY, enabled ? 'on' : 'off')
  } catch {
    /* нечего сохранять — настройка не переживёт перезапуск */
  }
  if (!enabled) stopCallVibration()
}

/** Вибрация доступна в этом браузере (Android; в Safari её нет). */
export function callVibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator
}

/**
 * Один раз пробует вибрировать после первого касания страницы.
 *
 * Chrome блокирует вибрацию до первого жеста («user activation»): без этого
 * входящий звонок на только что открытом приложении молчал бы.
 */
function bindUnlockOnce(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const events = ['pointerdown', 'touchstart', 'keydown'] as const
  events.forEach((eventName) =>
    window.addEventListener(
      eventName,
      () => {
        // Жест случился — ритм можно повторять (в том числе текущий звонок).
        if (repeatTimer !== undefined) buzzNow()
      },
      { passive: true, once: true }
    )
  )
}

function buzzNow(): void {
  try {
    navigator.vibrate(CALL_VIBRATION_PATTERN)
  } catch {
    /* нет доступа к вибрации — звонок всё равно звенит звуком */
  }
}

/**
 * Начинает вибрировать, пока звонок звонит (входящий; зовущий ждёт без вибрации).
 *
 * Выключенная настройка или браузер без Vibration API — просто тишина: звонок от
 * этого не страдает.
 */
export function startCallVibration(): void {
  if (!isCallVibrationEnabled() || !callVibrationSupported()) return
  stopCallVibration()
  buzzNow()
  bindUnlockOnce()
  repeatTimer = window.setInterval(buzzNow, CALL_VIBRATION_REPEAT_MS)
}

/** Останавливает вибрацию: звонок приняли, отклонили или он завершился. */
export function stopCallVibration(): void {
  // Если мы и не вибрировали — телефон не трогаем вовсе: вызов `vibrate(0)`
  // сбрасывает ЛЮБУЮ вибрацию, в том числе чужую (например, исходящий звонок к
  // нему не имеет отношения, и «глушить» им нечего).
  if (repeatTimer === undefined) return
  window.clearInterval(repeatTimer)
  repeatTimer = undefined
  try {
    // Обрываем уже начатый ритм: иначе телефон продолжит дрожать после ответа.
    if (callVibrationSupported()) navigator.vibrate(0)
  } catch {
    /* нечего останавливать */
  }
}
