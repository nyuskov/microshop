import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  callRoute,
  callVerificationCode,
  formatVerificationCode,
  routeHint,
  routeLabel,
  sdpFingerprints,
  verificationCodeFromBytes,
  verificationDigest,
  VERIFICATION_DIGITS
} from '@/utils/callVerification'

/**
 * Проверка подлинности звонка (пункт A6 плана).
 *
 * Медиа в звонке 1-на-1 шифруется напрямую (DTLS-SRTP), релей видит только
 * шифротекст — но сигналинг ведёт сервер, и теоретически он мог бы свести
 * человека с третьим участником. Проверить это может только человек, сравнив код
 * с собеседником. Поэтому главное в тестах — что код совпадает у обоих (иначе
 * сверка невозможна) и что он разный при подмене сертификата.
 */

/** Полоса SDP из реального согласования (обрезана до значимых строк). */
const sdp = (fingerprint: string, extra = ''): string =>
  [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=ice-ufrag:abcd',
    'a=fingerprint:sha-256 ' + fingerprint,
    'a=setup:actpass',
    extra
  ].join('\r\n')

const FINGERPRINT_A =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'
const FINGERPRINT_B =
  '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00'

describe('sdpFingerprints', () => {
  it('вытаскивает отпечаток сертификата и нормализует его', () => {
    const [value] = sdpFingerprints(sdp(FINGERPRINT_A))
    // Двоеточия убираем и приводим к нижнему регистру: один и тот же
    // сертификат в разных браузерах записан по-разному.
    expect(value).toBe('aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899')
  })

  it('на SDP без отпечатка и на пустом значении отдаёт пустой список', () => {
    expect(sdpFingerprints('v=0\r\nm=audio 9\r\n')).toEqual([])
    expect(sdpFingerprints(null)).toEqual([])
    expect(sdpFingerprints(undefined)).toEqual([])
  })

  it('игнорирует другие алгоритмы: код считаем по sha-256', () => {
    const extra = 'a=fingerprint:sha-1 AA:BB\r\n'
    expect(sdpFingerprints(sdp(FINGERPRINT_A, extra))).toHaveLength(1)
  })

  it('собирает несколько отпечатков (пересогласование SDP)', () => {
    const extra = `a=fingerprint:sha-256 ${FINGERPRINT_B}\r\n`
    expect(sdpFingerprints(sdp(FINGERPRINT_A, extra))).toHaveLength(2)
  })
})

describe('verificationDigest', () => {
  it('порядок сторон не важен — код должен совпасть у обоих', () => {
    const mine = sdp(FINGERPRINT_A)
    const theirs = sdp(FINGERPRINT_B)
    expect(verificationDigest(mine, theirs)).toBe(verificationDigest(theirs, mine))
  })

  it('дубли отпечатков не меняют результат', () => {
    const mine = sdp(FINGERPRINT_A)
    const mineTwice = sdp(FINGERPRINT_A, `a=fingerprint:sha-256 ${FINGERPRINT_A}\r\n`)
    expect(verificationDigest(mineTwice, sdp(FINGERPRINT_B))).toBe(
      verificationDigest(mine, sdp(FINGERPRINT_B))
    )
  })

  it('пусто, если отпечатков нет (соединение ещё не установилось)', () => {
    expect(verificationDigest(null, null)).toBe('')
  })
})

describe('verificationCodeFromBytes', () => {
  it('даёт ровно 6 цифр с ведущими нулями', () => {
    expect(verificationCodeFromBytes(new Uint8Array([0, 0, 0, 0]))).toBe('000000')
    expect(verificationCodeFromBytes(new Uint8Array([1, 2, 3, 4]))).toHaveLength(
      VERIFICATION_DIGITS
    )
  })

  it('на одних байтах даёт тот же код, на других — другой', () => {
    const a = verificationCodeFromBytes(new Uint8Array([9, 8, 7, 6]))
    const b = verificationCodeFromBytes(new Uint8Array([9, 8, 7, 6]))
    const c = verificationCodeFromBytes(new Uint8Array([9, 8, 7, 7]))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('callVerificationCode', () => {
  it('совпадает у двух участников (каждый берёт свой и чужой SDP)', async () => {
    const mine = sdp(FINGERPRINT_A)
    const theirs = sdp(FINGERPRINT_B)
    const fromMe = await callVerificationCode(mine, theirs)
    const fromPeer = await callVerificationCode(theirs, mine)
    expect(fromMe).not.toBeNull()
    expect(fromMe).toBe(fromPeer)
    expect(fromMe).toHaveLength(VERIFICATION_DIGITS)
  })

  it('расходится, если сервер подсунул другое соединение (подмена)', async () => {
    const mine = sdp(FINGERPRINT_A)
    const honest = await callVerificationCode(mine, sdp(FINGERPRINT_B))
    const attacked = await callVerificationCode(
      mine,
      sdp(
        '00:11:22:33:44:55:66:77:88:99:00:11:22:33:44:55:66:77:88:99:00:11:22:33:44:55:66:77:88:99:00:11'
      )
    )
    expect(attacked).not.toBe(honest)
  })

  it('без отпечатков отдаёт null (не «000000» — показывать нечего)', async () => {
    expect(await callVerificationCode(null, null)).toBeNull()
    expect(await callVerificationCode('v=0', 'v=0')).toBeNull()
  })
})

describe('formatVerificationCode', () => {
  it('делит код на две тройки — так его диктуют вслух', () => {
    expect(formatVerificationCode('123456')).toBe('123 456')
  })

  it('не трогает неожиданную длину', () => {
    expect(formatVerificationCode('12345')).toBe('12345')
  })
})

describe('маршрут медиа', () => {
  it('релей отличается от прямого соединения', () => {
    expect(callRoute('relay')).toBe('relay')
    expect(callRoute('srflx')).toBe('direct')
    expect(callRoute('prflx')).toBe('direct')
    expect(callRoute('host')).toBe('direct')
  })

  it('пока связи нет — «определяем»', () => {
    expect(callRoute(null)).toBe('unknown')
    expect(callRoute('unknown')).toBe('unknown')
    expect(routeLabel('unknown')).toContain('определяем')
  })

  it('подписи честные: «Напрямую (P2P)» против «Через релей»', () => {
    expect(routeLabel('direct')).toBe('Напрямую (P2P)')
    expect(routeLabel('relay')).toBe('Через релей')
  })

  it('пояснение к «через релей» говорит, что шифрование сохраняется', () => {
    // Иначе бейдж читается как «менее защищено», хотя TURN видит шифротекст.
    expect(routeHint('relay')).toContain('DTLS-SRTP')
    expect(routeHint('relay')).toContain('расшифровать')
    expect(routeHint('direct')).toContain('напрямую')
  })
})

/**
 * Связка с экраном звонка и стором: правила бесполезны, если код не считается и
 * бейдж не показывает маршрут.
 */
describe('связка со стором и экраном звонка', () => {
  const source = (path: string) => readFileSync(path, 'utf8')

  it('стор считает код по SDP обеих сторон', () => {
    const store = source('src/stores/call.ts')
    expect(store).toContain('refreshVerificationCode')
    expect(store).toContain('localDescription')
    expect(store).toContain('remoteDescription')
    // Код относится к конкретному соединению: при завершении его сбрасываем.
    expect(store).toContain("this.verificationCode = ''")
  })

  it('экран звонка показывает маршрут вместо общего «Сквозное шифрование»', () => {
    const overlay = source('src/components/calls/CallOverlay.vue')
    expect(overlay).toContain('callStore.callRouteLabel')
    expect(overlay).toContain('callStore.callRouteHint')
    expect(overlay).not.toContain('Сквозное шифрование')
  })

  it('в меню звонка есть «Код сверки» и панель с кодом', () => {
    const overlay = source('src/components/calls/CallOverlay.vue')
    expect(overlay).toContain('Код сверки')
    expect(overlay).toContain('formatVerificationCode')
    expect(overlay).toContain('verifyOpen')
  })
})
