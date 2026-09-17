import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  AUDIO_BITRATE_BAD,
  AUDIO_BITRATE_FAIR,
  AUDIO_BITRATE_GOOD,
  AUDIO_OPUS_PARAMS,
  SCREEN_BITRATE,
  VIDEO_BITRATE_BAD,
  VIDEO_BITRATE_FAIR,
  VIDEO_BITRATE_GOOD,
  VIDEO_FRAMERATE_BAD,
  VIDEO_FRAMERATE_GOOD,
  audioBitrateFor,
  jitterTargetsFor,
  qualityStepFor,
  tuneOpusSdp,
  tunedDescription,
  videoBitrateFor,
  videoFramerateFor,
  videoScaleFor
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
const output = source('src/stores/call/output.ts')
const grid = source('src/components/calls/CallGrid.vue')

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
  remoteLossPercent: 0,
  availableOutgoingKbps: 0,
  qualityLimitation: '',
  jitterBufferDelayMs: 0,
  framesDropped: 0,
  freezeCount: 0,
  nackCount: 0,
  jitterMs: 5,
  inboundKbps: 0,
  outboundKbps: 0,
  codecs: [],
  ...patch
})

describe('параметры Opus в SDP', () => {
  it('включает помехоустойчивость и моно', () => {
    expect(AUDIO_OPUS_PARAMS).toContain('useinbandfec=1')
    expect(AUDIO_OPUS_PARAMS).toContain('stereo=0')
    expect(AUDIO_OPUS_PARAMS).toContain('sprop-stereo=0')
    // 48 кбит/с — чистый голос; ниже слышно «песок» на шипящих.
    expect(AUDIO_OPUS_PARAMS).toContain('maxaveragebitrate=48000')
  })

  it('НЕ включает DTX: экономия тишины слышна щелчками на стыках фраз', () => {
    expect(AUDIO_OPUS_PARAMS).not.toContain('usedtx')
    // 20 мс пакетирование: мельче — больше пакетов и больше потерь на канале.
    expect(AUDIO_OPUS_PARAMS).toContain('minptime=20')
    expect(AUDIO_OPUS_PARAMS).not.toContain('minptime=10')
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

describe('ступени для звука, разрешения и кадров', () => {
  it('сужает звук на потерях: мелкие пакеты теряются реже', () => {
    expect(audioBitrateFor(diagnostics({}))).toBe(AUDIO_BITRATE_GOOD)
    expect(audioBitrateFor(diagnostics({ lossPercent: 3 }))).toBe(AUDIO_BITRATE_FAIR)
    expect(audioBitrateFor(diagnostics({ lossPercent: 12 }))).toBe(AUDIO_BITRATE_BAD)
  })

  it('учитывает потери НАШЕГО потока, о которых сообщил собеседник', () => {
    // Приём чистый, но у собеседника пропадает каждый десятый пакет — это наш аплинк.
    expect(qualityStepFor(diagnostics({ remoteLossPercent: 10 }))).toBe('bad')
    expect(videoScaleFor(diagnostics({ remoteLossPercent: 3 }))).toBe(1.5)
  })

  it('ужимает картинку при плохой связи', () => {
    expect(videoScaleFor(diagnostics({}))).toBe(1)
    expect(videoScaleFor(diagnostics({ lossPercent: 3 }))).toBe(1.5)
    expect(videoScaleFor(diagnostics({ lossPercent: 12 }))).toBe(2)
    expect(videoFramerateFor(diagnostics({}))).toBe(VIDEO_FRAMERATE_GOOD)
    expect(videoFramerateFor(diagnostics({ lossPercent: 12 }))).toBe(VIDEO_FRAMERATE_BAD)
  })

  it('понижает ступень по доступной полосе, даже когда потерь нет', () => {
    expect(qualityStepFor(diagnostics({ availableOutgoingKbps: 150 }))).toBe('bad')
    expect(qualityStepFor(diagnostics({ availableOutgoingKbps: 300 }))).toBe('fair')
    expect(qualityStepFor(diagnostics({ availableOutgoingKbps: 2000 }))).toBe('good')
  })

  it('буфер воспроизведения растёт вместе с дрожанием', () => {
    expect(jitterTargetsFor(null)).toEqual({ audioMs: 50, videoMs: 200 })
    expect(jitterTargetsFor(diagnostics({ jitterMs: 30 })).audioMs).toBe(80)
    // Очень большое дрожание не должно раздувать буфер бесконечно.
    expect(jitterTargetsFor(diagnostics({ jitterMs: 900 })).audioMs).toBe(140)
    expect(jitterTargetsFor(diagnostics({ jitterMs: 900 })).videoMs).toBe(700)
  })
})

describe('настройка отправки в сторе', () => {
  it('локальные описания уходят с настроенным Opus', () => {
    // Иначе параметры помехоустойчивости не попадут ни в offer, ни в answer.
    expect(store).not.toMatch(/setLocalDescription\((?!sent|offer|answer)\w+\)/)
    expect((store.match(/tunedDescription\(/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('настройки применяются к КАЖДОЙ связи по её статистике', () => {
    // В группе качество у собеседников разное: общая ступень резала бы видео
    // всем по худшему, а на телефоне важна суммарная отправка.
    expect(store).toMatch(/runtime\.linkQuality\.set\(link\.peerId, diagnostics\)/)
    expect(store).toMatch(/_applyLinkTuning\(link, diagnostics\)/)
  })

  it('видео уступает разговору при долгой плохой связи', () => {
    expect(store).toMatch(/badQualityStreak >= VIDEO_PAUSE_BAD_POLLS/)
    expect(store).toMatch(/goodQualityStreak >= VIDEO_RESUME_GOOD_POLLS/)
    expect(store).toContain('runtime.pausedVideoSenders')
  })

  it('буфер приёмников настраивается после согласования', () => {
    expect(store).toMatch(/tuneReceivers\(link\.pc, jitterTargetsFor/)
  })

  it('показ экрана не режется ступенями сети', () => {
    expect(store).toMatch(/videoBitrate: SCREEN_BITRATE/)
    expect(store).toMatch(/screen: true/)
    expect(SCREEN_BITRATE).toBeGreaterThan(VIDEO_BITRATE_GOOD)
  })

  it('камера, которую не отдали, не отменяет звонок', () => {
    // Раньше это был отказ от звонка — хотя разговаривать было можно.
    expect(store).toContain('acquireLocalMedia')
    expect(store).toContain('_applyAcquiredKind')
  })

  it('подсказки кодеку ставятся на локальный поток', () => {
    expect(store).toContain('applyTrackHints(stream)')
  })
})

describe('звук собеседников не дублируется и не теряется', () => {
  it('в микшере держатся ВСЕ собеседники, а не последний', () => {
    // Раньше новый поток заменял прежний: в группе слышно было только одного.
    expect(output).toMatch(/callOutputSources\.push\(source\)/)
    expect(output).toMatch(/export function unwireRemoteOutput/)
    expect(output).not.toMatch(/callOutputSource\b(?!s)/)
  })

  it('громкость меняется плавно: мгновенная смена щёлкает', () => {
    expect(output).toContain('linearRampToValueAtTime')
    expect(output).not.toMatch(/gain\.value = volume/)
  })

  it('плитки в сетке глушатся, когда звук играет Web Audio', () => {
    // Иначе та же речь звучит дважды с задержкой — «расплывается» и слышится
    // как искажения.
    expect(grid).toMatch(/:muted="viaWebAudio"/)
    expect(grid).toMatch(/viaWebAudio\.value = callStore\.outputReady\(\)/)
  })

  it('ушедший участник убирается из микшера', () => {
    expect(store).toContain('unwireRemoteOutput(link.remoteStream)')
  })
})
