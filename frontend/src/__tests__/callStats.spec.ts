/**
 * Разбор статистики звонка и индикатор качества.
 *
 * Этими цифрами человек (и поддержка) отвечает на вопросы «почему нет звука» и
 * «почему плохо слышно»: маршрут медиа (напрямую или через релей), задержка,
 * потери, скорость. Проверяем на синтетическом отчёте `getStats()`.
 */
import { describe, expect, it } from 'vitest'
import {
  collectDiagnostics,
  connectionQuality,
  diagnosticsSummary,
  type CallDiagnostics,
  type StatsSample
} from '@/utils/callStats'

/** Синтетический отчёт `getStats()` (как её отдаёт браузер — коллекция с forEach). */
const report = (entries: Array<[string, Record<string, unknown>]>): RTCStatsReport =>
  new Map(entries) as unknown as RTCStatsReport

const peer = { iceConnectionState: 'connected', connectionState: 'connected' }

const audioReport = (bytesReceived: number) =>
  report([
    [
      'pair-1',
      {
        id: 'pair-1',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'local-1',
        currentRoundTripTime: 0.042
      }
    ],
    [
      'local-1',
      { id: 'local-1', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'tcp' }
    ],
    [
      'in-audio',
      {
        type: 'inbound-rtp',
        mimeType: 'audio/opus',
        bytesReceived,
        packetsLost: 5,
        packetsReceived: 995,
        jitter: 0.012
      }
    ],
    ['out-audio', { type: 'outbound-rtp', mimeType: 'audio/opus', bytesSent: 15000 }]
  ])

describe('разбор статистики соединения', () => {
  it('видит маршрут через релей, задержку, потери и кодеки', () => {
    const { diagnostics, sample } = collectDiagnostics(audioReport(20_000), peer, null, 1000)

    expect(diagnostics.iceState).toBe('connected')
    expect(diagnostics.candidateType).toBe('relay')
    expect(diagnostics.relayProtocol).toBe('tcp')
    expect(diagnostics.rttMs).toBe(42)
    expect(diagnostics.lossPercent).toBeCloseTo(0.5, 5)
    expect(diagnostics.jitterMs).toBe(12)
    expect(diagnostics.codecs).toEqual(['audio/opus'])
    // Без предыдущего замера скорость неизвестна — не врём нулём «все пропало».
    expect(diagnostics.inboundKbps).toBe(0)
    expect(sample).toEqual({ bytesReceived: 20_000, bytesSent: 15_000, at: 1000 })
  })

  it('считает скорость приёма по двум замерам', () => {
    const first = collectDiagnostics(audioReport(20_000), peer, null, 1000)
    const second = collectDiagnostics(audioReport(40_000), peer, first.sample, 2000)

    // 20 000 байт за секунду = 160 кбит/с
    expect(second.diagnostics.inboundKbps).toBe(160)
    expect(second.diagnostics.outboundKbps).toBe(0)
  })

  it('прямой маршрут (host) не путает с релеем', () => {
    const direct = report([
      [
        'pair-1',
        {
          id: 'pair-1',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          localCandidateId: 'local-1'
        }
      ],
      ['local-1', { id: 'local-1', type: 'local-candidate', candidateType: 'host' }]
    ])
    const { diagnostics } = collectDiagnostics(direct, peer, null, 0)

    expect(diagnostics.candidateType).toBe('host')
    expect(diagnostics.relayProtocol).toBe('')
    expect(diagnostics.codecs).toEqual([])
  })
})

describe('индикатор качества связи', () => {
  const withMetrics = (partial: Partial<CallDiagnostics>): CallDiagnostics => ({
    iceState: 'connected',
    connectionState: 'connected',
    candidateType: 'host',
    relayProtocol: '',
    rttMs: 40,
    lossPercent: 0,
    jitterMs: 5,
    inboundKbps: 32,
    outboundKbps: 32,
    codecs: [],
    ...partial
  })

  it('нормальная связь — без бейджа', () => {
    expect(connectionQuality(null)).toBe('good')
    expect(connectionQuality(withMetrics({}))).toBe('good')
  })

  it('потери и задержка дают «плохую связь»', () => {
    expect(connectionQuality(withMetrics({ lossPercent: 4 }))).toBe('fair')
    expect(connectionQuality(withMetrics({ rttMs: 340 }))).toBe('fair')
    expect(connectionQuality(withMetrics({ lossPercent: 12 }))).toBe('bad')
    expect(connectionQuality(withMetrics({ rttMs: 900 }))).toBe('bad')
  })

  it('краткая подпись объясняет, куда идёт медиа', () => {
    expect(diagnosticsSummary(null)).toBe('')
    expect(diagnosticsSummary(withMetrics({}))).toBe('напрямую · 40 мс')
    expect(
      diagnosticsSummary(
        withMetrics({ candidateType: 'relay', relayProtocol: 'tls', lossPercent: 2 })
      )
    ).toBe('через релей (tls) · 40 мс, потери 2%')
  })

  it('образец замера совместим с повторным вызовом', () => {
    const sample: StatsSample = { bytesReceived: 1, bytesSent: 2, at: 3 }
    expect(sample.bytesReceived).toBe(1)
  })
})
