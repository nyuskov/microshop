/**
 * Проверка подлинности звонка: код сверки и маршрут медиа.
 *
 * Зачем: в звонке 1-на-1 медиа шифруется напрямую между участниками
 * (DTLS-SRTP), TURN только релеит пакеты и расшифровать их не может. Но
 * сигналинг ведёт наш сервер, и теоретически он мог бы свести человека с третьим
 * участником (MITM). Отличить подмену может только человек: обе стороны видят
 * один и тот же код и сравнивают его вслух — как это делает Signal.
 *
 * Как считается: код — производная от отпечатков сертификатов DTLS
 * (`a=fingerprint` в SDP) ОБЕИХ сторон, взятых в отсортированном порядке. Каждая
 * сторона берёт свой локальный отпечаток и чужой из удалённого SDP, поэтому код
 * совпадает — а подменённый сертификат даёт другой код.
 *
 * Здесь только чистые функции (разбор SDP, цифры кода, маршрут): WebCrypto и
 * экран звонка живут в стор/компоненте, чтобы правила проверялись тестами.
 */

/** Сколько цифр в коде сверки: 6 — как в Signal, читается вслух за раз. */
export const VERIFICATION_DIGITS = 6

/** Тип отпечатка в SDP, который считаем своим (SHA-256 — стандарт WebRTC). */
const FINGERPRINT_ALGORITHM = 'sha-256'

/** Маршрут медиа: напрямую (P2P) или через наш релей. */
export type CallRoute = 'direct' | 'relay' | 'unknown'

/**
 * Отпечатки сертификатов DTLS из SDP.
 *
 * Возвращаем нормализованные (нижний регистр, без двоеточий) — иначе один и тот
 * же сертификат дал бы разные коды на разных браузерах.
 */
export function sdpFingerprints(sdp: string | null | undefined): string[] {
  if (!sdp) return []
  const result: string[] = []
  const pattern = new RegExp(`^a=fingerprint:${FINGERPRINT_ALGORITHM}\\s+(\\S+)`, 'gim')
  for (const match of sdp.matchAll(pattern)) {
    const normalized = match[1].replace(/[^0-9a-fA-F]/g, '').toLowerCase()
    if (normalized) result.push(normalized)
  }
  return result
}

/**
 * Строка для хеширования: отпечатки ОБЕИХ сторон в предсказуемом порядке.
 *
 * Сортировка обязательна: у каждого свой локальный и чужой удалённый отпечаток, и
 * без общего порядка коды у сторон разошлись бы. Дубли (пересогласование SDP,
 * повторный fingerprint в том же SDP) убираем — иначе код менялся бы от
 * безобидного пересогласования.
 */
export function verificationDigest(localSdp: string | null, remoteSdp: string | null): string {
  const all = new Set([...sdpFingerprints(localSdp), ...sdpFingerprints(remoteSdp)])
  return [...all].sort().join('|')
}

/** Байты хеша → 6 цифр с ведущими нулями. */
export function verificationCodeFromBytes(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes.slice(0, 4)) value = (value << 8n) + BigInt(byte)
  return String(value % 1000000n).padStart(VERIFICATION_DIGITS, '0')
}

/**
 * Код сверки звонка: одинаковый у обоих участников.
 *
 * `null` — отпечатков нет (соединение ещё не установилось): показывать нечего.
 */
export async function callVerificationCode(
  localSdp: string | null | undefined,
  remoteSdp: string | null | undefined
): Promise<string | null> {
  const digest = verificationDigest(localSdp ?? null, remoteSdp ?? null)
  if (!digest) return null
  const bytes = new TextEncoder().encode(digest)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return verificationCodeFromBytes(new Uint8Array(hash))
}

/** Код группами по 3 цифры — так его удобнее читать вслух. */
export const formatVerificationCode = (code: string): string =>
  code.length === VERIFICATION_DIGITS ? `${code.slice(0, 3)} ${code.slice(3)}` : code

/** Маршрут медиа по типу выбранной пары кандидатов (`getStats`). */
export function callRoute(candidateType: string | null | undefined): CallRoute {
  if (!candidateType || candidateType === 'unknown') return 'unknown'
  return candidateType === 'relay' ? 'relay' : 'direct'
}

/** Подпись маршрута для бейджа в звонке. */
export function routeLabel(route: CallRoute): string {
  if (route === 'relay') return 'Через релей'
  if (route === 'direct') return 'Напрямую (P2P)'
  return 'Маршрут: определяем…'
}

/**
 * Пояснение к бейджу: что именно означает маршрут.
 *
 * Нужно, потому что «через релей» у людей читается как «менее защищено», хотя
 * TURN видит только шифротекст.
 */
export function routeHint(route: CallRoute): string {
  if (route === 'relay') {
    return 'Медиа шифруется между участниками (DTLS-SRTP), релей только пересылает зашифрованные пакеты и расшифровать их не может'
  }
  if (route === 'direct') {
    return 'Медиа идёт напрямую между устройствами и защищено сквозным шифрованием (DTLS-SRTP)'
  }
  return 'Соединение ещё устанавливается'
}
