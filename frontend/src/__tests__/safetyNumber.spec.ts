import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  canonicalKey,
  digitGroups,
  digitsOf,
  groupsOf,
  orderKeys,
  safetyCodeFromBytes,
  SAFETY_GROUPS,
  SAFETY_GROUP_SIZE,
  SAFETY_SHORT_GROUPS
} from '@/utils/safetyNumber'

/**
 * Код проверки ключей шифрования (safety number).
 *
 * Повод: улучшение A2 из `docs/feature-proposals.md` — «сервер не читает
 * переписку» нельзя проверить словами. Теперь оба участника видят один и тот же
 * код и сверяют его вслух: совпал — ключи не подменены.
 *
 * Здесь проверяются чистые правила (нормализация ключа, порядок, цифры). Сама
 * криптография — `services/e2ee.ts`, её тесты работают через DOM-моки и здесь не
 * дублируются.
 */

/** Публичный JWK в том виде, в каком его отдаёт `crypto.subtle.exportKey`. */
const jwk = (x: string, y: string, crv = 'P-256') => JSON.stringify({ crv, kty: 'EC', x, y })

describe('canonicalKey', () => {
  it('берёт только точку на кривой и фиксирует порядок полей', () => {
    const json = JSON.stringify({ kty: 'EC', y: 'yyy', crv: 'P-256', x: 'xxx' })
    expect(canonicalKey(json)).toBe('P-256:xxx:yyy')
  })

  it('не зависит от пробелов в JSON', () => {
    const compact = jwk('aaa', 'bbb')
    const pretty = JSON.stringify(JSON.parse(compact), null, 2)
    expect(canonicalKey(pretty)).toBe(canonicalKey(compact))
  })

  it('возвращает null на пустом ключе и на мусоре', () => {
    // Пусто — собеседник ещё не открывал приложение, сверять нечего.
    expect(canonicalKey(null)).toBeNull()
    expect(canonicalKey('')).toBeNull()
    expect(canonicalKey('не json')).toBeNull()
    expect(canonicalKey('{}')).toBeNull()
    expect(canonicalKey(JSON.stringify({ crv: 'P-256', x: 'xxx' }))).toBeNull()
  })

  it('не путает разные ключи', () => {
    expect(canonicalKey(jwk('aaa', 'bbb'))).not.toBe(canonicalKey(jwk('aaa', 'ccc')))
  })
})

describe('orderKeys', () => {
  it('сортирует по канонической форме', () => {
    expect(orderKeys('b', 'a')).toEqual(['a', 'b'])
    expect(orderKeys('a', 'b')).toEqual(['a', 'b'])
  })

  it('даёт одинаковый порядок с обеих сторон', () => {
    const mine = 'P-256:aaa:bbb'
    const theirs = 'P-256:zzz:yyy'
    expect(orderKeys(mine, theirs)).toEqual(orderKeys(theirs, mine))
  })

  it('оставляет одинаковые ключи (чат с самим собой) на месте', () => {
    expect(orderKeys('same', 'same')).toEqual(['same', 'same'])
  })
})

describe('digitGroups', () => {
  it('делает ровно 12 групп по 5 цифр', () => {
    const bytes = new Uint8Array(64).map((_, index) => index)
    const groups = digitGroups(bytes)
    expect(groups).toHaveLength(SAFETY_GROUPS)
    for (const group of groups) {
      expect(group).toHaveLength(SAFETY_GROUP_SIZE)
      expect(group).toMatch(/^\d{5}$/)
    }
  })

  it('добивает ведущие нули, а не сокращает группу', () => {
    // Пять нулевых байт = 0 → «00000», иначе группа была бы «0» и код «плыл».
    expect(digitGroups(new Uint8Array(SAFETY_GROUP_SIZE))).toEqual(['00000'])
  })

  it('останавливается, когда байты кончились', () => {
    expect(digitGroups(new Uint8Array(5))).toHaveLength(1)
    // Неполный «хвост» тоже становится группой, а не теряется.
    expect(digitGroups(new Uint8Array(7))).toHaveLength(2)
    expect(digitGroups(new Uint8Array(0))).toEqual([])
  })

  it('меняет группы при смене байтов', () => {
    const first = digitGroups(new Uint8Array(60).map(() => 1))
    const second = digitGroups(new Uint8Array(60).map(() => 2))
    expect(first).not.toEqual(second)
  })
})

describe('digitsOf и groupsOf', () => {
  it('склеивает и разбирает обратно без потерь', () => {
    const groups = ['12345', '00001', '99999']
    expect(digitsOf(groups)).toBe('123450000199999')
    expect(groupsOf(digitsOf(groups))).toEqual(groups)
  })

  it('не отдаёт больше 12 групп даже на длинной строке', () => {
    expect(groupsOf('1'.repeat(70))).toHaveLength(SAFETY_GROUPS)
  })

  it('на пустой строке отдаёт пустой список', () => {
    expect(groupsOf('')).toEqual([])
  })
})

describe('safetyCodeFromBytes', () => {
  it('собирает полный код из 60 цифр и короткий из 30', () => {
    const code = safetyCodeFromBytes(new Uint8Array(64).map((_, index) => index * 3))
    expect(code.groups).toHaveLength(SAFETY_GROUPS)
    expect(code.digits).toHaveLength(SAFETY_GROUPS * SAFETY_GROUP_SIZE)
    expect(code.shortGroups).toHaveLength(SAFETY_SHORT_GROUPS)
    expect(code.digits.startsWith(code.shortGroups.join(''))).toBe(true)
  })

  it('на одних и тех же байтах даёт один и тот же код', () => {
    const bytes = new Uint8Array(64).map((_, index) => (index * 7) % 256)
    expect(safetyCodeFromBytes(bytes)).toEqual(safetyCodeFromBytes(bytes))
  })

  it('на разных байтах даёт разные коды', () => {
    const a = safetyCodeFromBytes(new Uint8Array(64).fill(11))
    const b = safetyCodeFromBytes(new Uint8Array(64).fill(12))
    expect(a.digits).not.toBe(b.digits)
  })
})

/**
 * Проверки по исходникам: наборы правил сверки должны быть подключены к UI и к
 * криптографии. Тесты по DOM здесь не пишем — диалог тонкий, а регрессией было
 * бы именно «кнопка есть, а проверить нечего» или «код считается по-разному».
 */
describe('связка с UI и криптографией', () => {
  // Пути от корня frontend: vitest запускается из него (как в остальных тестах).
  const source = (relative: string) => readFileSync(relative, 'utf8')

  const e2ee = source('src/services/e2ee.ts')
  const dialog = source('src/components/messenger/SafetyNumberDialog.vue')
  const info = source('src/components/messenger/ChatInfo.vue')

  it('код считается от ключей обоих участников в общем порядке', () => {
    expect(e2ee).toContain('safetyNumberWithPeer')
    expect(e2ee).toContain('orderKeys')
    expect(e2ee).toContain('SHA-512')
    expect(e2ee).toContain('safetyCodeFromBytes')
  })

  it('диалог берёт код только из e2ee и ничего не отправляет на сервер', () => {
    expect(dialog).toContain("from '@/services/e2ee'")
    expect(dialog).not.toContain('api.')
    expect(dialog).not.toContain('fetch(')
  })

  it('диалог объясняет, зачем сравнивать код, и что он меняется с новым устройством', () => {
    expect(dialog).toContain('Сравните этот код')
    expect(dialog).toContain('нового устройства')
  })

  it('кнопка проверки есть в карточке чата и только для включённого E2EE', () => {
    expect(info).toContain('Проверить шифрование')
    expect(info).toContain('SafetyNumberDialog')
    expect(info).toMatch(/v-if="e2eeEnabled"/)
  })
})
