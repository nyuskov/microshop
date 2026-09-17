import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  AUDIO_OPUS_PARAMS,
  VIDEO_BITRATE_BAD,
  VIDEO_BITRATE_FAIR,
  VIDEO_BITRATE_GOOD,
  tuneOpusSdp,
  tunedDescription,
  videoBitrateFor
} from '@/stores/call/quality'
import type { CallDiagnostics } from '@/utils/callStats'

/**
 * Качество звонка на плохой сети (междугородние разговоры).
 *
 * Проверяем две вещи, которые в браузере руками не увидеть: параметры Opus в
 * SDP (встроенная помехоустойчивость, DTX, моно) и выбор битрейта видео по
 * статистике канала.
 */
const source = (path: string): string => readFileSync(path, 'utf8')
const store = source('src/stores/call.ts')

/** Минимальное SDP с Opus — как его отдаёт браузер. */
const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtcp-fb:111 transport-cc',
  ''
].join('\r\n')

/** Диагностика с нужными значениями (остальное — «хорошо»). */
const diagnostics = (patch: Partial<CallDiagnostics>): CallDiagnostics => ({
  iceState: 'connected',
  connectionState: 'connected',
  candidateType: 'srflx',
  relayProtocol: '',
  rttMs: 40,
  lossPercent: 0,
  jitterMs: 5,
  inboundKbps: 0,
  outboundKbps: 0,
  codecs: [],
  ...patch
})

describe('параметры Opus в SDP', () => {
  it('включает помехоустойчивость, DTX и моно', () => {
    expect(AUDIO_OPUS_PARAMS).toContain('useinbandfec=1')
    expect(AUDIO_OPUS_PARAMS).toContain('usedtx=1')
    expect(AUDIO_OPUS_PARAMS).toContain('stereo=0')
  })

  it('подменяет существующий fmtp и сохраняет структуру SDP', () => {
    const result = tuneOpusSdp(SDP)
    expect(result).toContain(`a=fmtp:111 ${AUDIO_OPUS_PARAMS}`)
    expect(result).not.toContain('minptime=10;useinbandfec=1\r\n')
    // Прочие строки на месте: описание иначе станет недействительным.
    expect(result).toContain('a=rtpmap:111 opus/48000/2')
    expect(result).toContain('a=rtcp-fb:111 transport-cc')
    expect(result.split('\r\n').length).toBe(SDP.split('\r\n').length)
  })

  it('добавляет fmtp, если браузер его не прислал', () => {
    const withoutFmtp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      ''
    ].join('\r\n')
    const result = tuneOpusSdp(withoutFmtp)
    const lines = result.split('\r\n')
    expect(lines[lines.indexOf('a=rtpmap:111 opus/48000/2') + 1]).toBe(
      `a=fmtp:111 ${AUDIO_OPUS_PARAMS}`
    )
  })

  it('не трогает описание без Opus', () => {
    const other = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=rtpmap:0 PCMU/8000\r\n'
    expect(tuneOpusSdp(other)).toBe(other)
    expect(tunedDescription({ type: 'offer' })).toEqual({ type: 'offer' })
  })
})

describe('битрейт видео по качеству сети', () => {
  it('на хорошей сети отдаёт полное качество', () => {
    expect(videoBitrateFor(diagnostics({}))).toBe(VIDEO_BITRATE_GOOD)
  })

  it('при потерях и дрожании режет видео, а не звук', () => {
    expect(videoBitrateFor(diagnostics({ lossPercent: 3 }))).toBe(VIDEO_BITRATE_FAIR)
    expect(videoBitrateFor(diagnostics({ jitterMs: 50 }))).toBe(VIDEO_BITRATE_FAIR)
    expect(videoBitrateFor(diagnostics({ rttMs: 500 }))).toBe(VIDEO_BITRATE_FAIR)
    expect(videoBitrateFor(diagnostics({ lossPercent: 12 }))).toBe(VIDEO_BITRATE_BAD)
    expect(videoBitrateFor(diagnostics({ jitterMs: 120 }))).toBe(VIDEO_BITRATE_BAD)
  })

  it('без статистики держит средний битрейт', () => {
    expect(videoBitrateFor(null)).toBe(VIDEO_BITRATE_FAIR)
  })
})

describe('настройка отправки в сторе', () => {
  it('локальные описания уходят с настроенным Opus', () => {
    // Иначе параметры помехоустойчивости не попадут ни в offer, ни в answer.
    expect(store).not.toMatch(/setLocalDescription\((?!sent|offer|answer)\w+\)/)
    expect((store.match(/tunedDescription\(/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('битрейт подстраивается по статистике и не дёргается зря', () => {
    expect(store).toMatch(/videoBitrateFor\(diagnostics\)/)
    expect(store).toMatch(/if \(target === runtime\.videoBitrate\) return/)
  })

  it('подсказки кодеку ставятся на локальный поток', () => {
    expect(store).toContain('applyTrackHints(stream)')
  })
})
