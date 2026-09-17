/**
 * Код проверки ключей (safety number): «эта переписка правда между нами».
 *
 * Зачем: E2EE обещает, что сервер не читает сообщения, но обмен ключами идёт
 * через сервер — значит именно он мог бы подменить ключ собеседника и читать
 * переписку (MITM). Отличить подмену может только человек: два участника
 * сравнивают одинаковый код вслух или глазами. Совпало — ключи у обоих те, что
 * нужно, и сервер в середине отсутствует.
 *
 * Как считается: SHA-512 от публичных ключей ОБОИХ участников, взятых в
 * предсказуемом порядке (сортировка), и первые 60 байт превращаются в 12 групп
 * по 5 цифр. Порядок важен: код должен совпадать у обоих участников, поэтому
 * ключи сортируются, а не берутся «мой, потом его».
 *
 * Здесь только чистые функции (байты → цифры, нормализация ключа): сам обмен
 * ключами и WebCrypto живут в `services/e2ee.ts` — так правила проверяются
 * тестами без DOM и без криптографии.
 */

/** Сколько цифр в одной группе кода (как в Signal — по 5, читать вслух удобно). */
export const SAFETY_GROUP_SIZE = 5

/** Сколько групп показываем: 12 по 5 цифр = 60 цифр. */
export const SAFETY_GROUPS = 12

/** Короткая версия для быстрой сверки: первые 6 групп (30 цифр). */
export const SAFETY_SHORT_GROUPS = 6

/**
 * Приводит публичный ключ (JWK) к каноническому виду.
 *
 * JSON одного и того же ключа может отличаться порядком полей и пробелами —
 * если хешировать «как пришло», код не совпал бы у двух участников. Берём
 * только значимые поля точки на кривой и фиксируем порядок.
 */
export function canonicalKey(jwkJson: string | null | undefined): string | null {
  if (!jwkJson) return null
  try {
    const jwk = JSON.parse(jwkJson) as Record<string, unknown>
    const crv = typeof jwk.crv === 'string' ? jwk.crv : ''
    const x = typeof jwk.x === 'string' ? jwk.x : ''
    const y = typeof jwk.y === 'string' ? jwk.y : ''
    if (!crv || !x || !y) return null
    return `${crv}:${x}:${y}`
  } catch {
    return null
  }
}

/**
 * Порядок ключей в коде проверки: лексикографический по канонической форме.
 *
 * Сортировка (а не «мой, потом его») нужна, чтобы код совпадал у обоих
 * участников — иначе каждый видел бы свой вариант и сверка была бы невозможна.
 */
export function orderKeys(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

/**
 * Превращает байты хеша в группы цифр.
 *
 * Каждые 5 байт берём как большое число по модулю 100000 — это даёт ровно
 * 5 цифр с ведущими нулями. Так же поступает Signal: код должен быть коротким,
 * но не «похожим» у разных ключей.
 */
export function digitGroups(bytes: Uint8Array, groups: number = SAFETY_GROUPS): string[] {
  const result: string[] = []
  for (let index = 0; index < groups; index += 1) {
    const chunk = bytes.slice(index * SAFETY_GROUP_SIZE, (index + 1) * SAFETY_GROUP_SIZE)
    if (chunk.length === 0) break
    let value = 0n
    for (const byte of chunk) value = (value << 8n) + BigInt(byte)
    result.push(String(value % 100000n).padStart(SAFETY_GROUP_SIZE, '0'))
  }
  return result
}

/** Склеивает группы в одну строку цифр (для копирования). */
export const digitsOf = (groups: string[]): string => groups.join('')

/** Разбивает строку цифр обратно на группы (для отображения). */
export const groupsOf = (digits: string): string[] =>
  digits.match(/.{1,5}/g)?.slice(0, SAFETY_GROUPS) ?? []

/**
 * Код проверки для отпечатка: группы, короткая версия и строка целиком.
 *
 * `groups` — полная сверка (60 цифр), `shortGroups` — быстрая (30 цифр).
 */
export interface SafetyCode {
  groups: string[]
  shortGroups: string[]
  digits: string
}

/** Собирает код проверки из байтов хеша. */
export function safetyCodeFromBytes(bytes: Uint8Array): SafetyCode {
  const groups = digitGroups(bytes)
  const shortGroups = groups.slice(0, SAFETY_SHORT_GROUPS)
  return { groups, shortGroups, digits: digitsOf(groups) }
}
