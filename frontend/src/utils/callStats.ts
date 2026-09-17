/**
 * Разбор статистики WebRTC (`getStats`) — для панели диагностики и индикатора
 * качества связи.
 *
 * Зачем: в звонках бывают жалобы «нет звука», «чёрный экран», «слышно плохо», и
 * по одному лишь состоянию ICE не понять, что происходит: соединение может
 * числиться установленным, пока пакеты не идут, а может идти через TURN-релей,
 * где счёт идёт на потери. Здесь всё это вытаскивается в простые поля, чтобы
 * интерфейс мог показать их человеку (и поддержке) без чтения консоли.
 *
 * Функции чистые: статистика передаётся как обычная коллекция `getStats()`, поэтому
 * их легко проверить тестами.
 */

/** Куда пошёл звонок: напрямую, через NAT или через наш релей. */
export type CandidateKind = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown'

/** Итог опроса соединения. */
export interface CallDiagnostics {
  /** Состояние ICE (`connected`/`failed`/…). */
  iceState: string
  /** Состояние соединения целиком (ICE + DTLS). */
  connectionState: string
  /** Тип выбранной пары кандидатов. */
  candidateType: CandidateKind
  /** Транспорт релея (`udp`/`tcp`/`tls`) — только когда идём через TURN. */
  relayProtocol: string
  /** Задержка «туда-обратно», мс. */
  rttMs: number
  /** Потери на приёме, %. */
  lossPercent: number
  /** Дрожание задержки, мс. */
  jitterMs: number
  /**
   * Потери в НАШЕМ исходящем потоке, % (по отчётам собеседника).
   *
   * `lossPercent` показывает, что теряется по дороге К НАМ, а на мобильной сети
   * чаще страдает отправка: без этой цифры мы резали видео «не за то».
   */
  remoteLossPercent: number
  /** Доступная исходящая полоса по оценке транспорта, кбит/с (0 — неизвестно). */
  availableOutgoingKbps: number
  /** Что ограничивает отправку: `bandwidth`, `cpu`, `other` (пусто — ничего). */
  qualityLimitation: string
  /** Средняя задержка в буфере воспроизведения, мс. */
  jitterBufferDelayMs: number
  /** Сколько кадров собеседника потеряно до отрисовки. */
  framesDropped: number
  /** Сколько раз видео собеседника «замирало» (freezeCount). */
  freezeCount: number
  /** Сколько раз переспрашивали потерянные пакеты (NACK). */
  nackCount: number
  /** Скорость приёма, кбит/с (между опросами). */
  inboundKbps: number
  /** Скорость отправки, кбит/с (между опросами). */
  outboundKbps: number
  /** Кодеки, которыми идёт разговор (`audio/opus`, `video/VP8` и т.п.). */
  codecs: string[]
}

/** Состояние связи для интерфейса. */
export type ConnectionQuality = 'good' | 'fair' | 'bad'

/** Значения статистики, которые могут быть любыми по типу. */
interface RawStat {
  type?: string
  [key: string]: unknown
}

/** Время и объёмы предыдущего опроса — нужны, чтобы посчитать скорость. */
export interface StatsSample {
  bytesReceived: number
  bytesSent: number
  at: number
}

/** Приводит поле статистики к числу (нет значения — 0). */
function num(stat: RawStat, key: string): number {
  const value = stat[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Приводит поле статистики к строке (нет значения — пусто). */
function str(stat: RawStat, key: string): string {
  const value = stat[key]
  return typeof value === 'string' ? value : ''
}

/** Тип выбранной пары кандидатов (host/srflx/relay) из статистики. */
function candidateKind(stat: RawStat): CandidateKind {
  const type = str(stat, 'candidateType')
  if (type === 'host' || type === 'srflx' || type === 'prflx' || type === 'relay') {
    return type
  }
  return 'unknown'
}

/**
 * Собирает диагностику из отчёта `getStats()`.
 *
 * `previous` — предыдущий замер (для скорости); без него скорость будет 0.
 */
export function collectDiagnostics(
  report: RTCStatsReport,
  peer: { iceConnectionState: string; connectionState: string },
  previous: StatsSample | null,
  now: number = Date.now()
): { diagnostics: CallDiagnostics; sample: StatsSample } {
  const stats: RawStat[] = []
  report.forEach((stat: RawStat) => {
    stats.push(stat)
  })
  const byId = new Map<string, RawStat>()
  for (const stat of stats) {
    const id = str(stat, 'id')
    if (id) byId.set(id, stat)
  }

  // Выбранная (nominated) пара: по ней реально идут пакеты.
  let pair: RawStat | undefined
  for (const stat of stats) {
    if (stat.type !== 'candidate-pair') continue
    if (stat.state !== 'succeeded') continue
    if (stat.nominated === true || stat.selected === true) {
      pair = stat
      break
    }
    if (!pair) pair = stat
  }
  const localCandidate = pair ? byId.get(str(pair, 'localCandidateId')) : undefined
  const rttMs = pair ? Math.round(num(pair, 'currentRoundTripTime') * 1000) : 0

  let bytesReceived = 0
  let bytesSent = 0
  let packetsLost = 0
  let packetsReceived = 0
  let packetsSent = 0
  let remotePacketsLost = 0
  let jitterSeconds = 0
  let jitterBufferDelay = 0
  let jitterBufferEmitted = 0
  let framesDropped = 0
  let freezeCount = 0
  let nackCount = 0
  let qualityLimitation = ''
  const codecs = new Set<string>()

  for (const stat of stats) {
    if (stat.type === 'inbound-rtp') {
      bytesReceived += num(stat, 'bytesReceived')
      packetsLost += num(stat, 'packetsLost')
      packetsReceived += num(stat, 'packetsReceived')
      jitterSeconds = Math.max(jitterSeconds, num(stat, 'jitter'))
      jitterBufferDelay += num(stat, 'jitterBufferDelay')
      jitterBufferEmitted += num(stat, 'jitterBufferEmittedCount')
      framesDropped += num(stat, 'framesDropped')
      freezeCount += num(stat, 'freezeCount')
      nackCount += num(stat, 'nackCount')
      const mime = str(stat, 'mimeType')
      if (mime) codecs.add(mime)
    } else if (stat.type === 'outbound-rtp') {
      bytesSent += num(stat, 'bytesSent')
      packetsSent += num(stat, 'packetsSent')
      // «Хуже» — это cpu и bandwidth: они прямо мешают отправлять видео.
      const reason = str(stat, 'qualityLimitationReason')
      if (reasonPreference(reason) > reasonPreference(qualityLimitation)) qualityLimitation = reason
      const mime = str(stat, 'mimeType')
      if (mime) codecs.add(mime)
    } else if (stat.type === 'remote-inbound-rtp') {
      // Отчёт собеседника о НАШЕМ потоке: его потери — это наш аплинк.
      remotePacketsLost += num(stat, 'packetsLost')
    }
  }

  const total = packetsLost + packetsReceived
  const remoteTotal = remotePacketsLost + packetsSent
  const elapsedMs = previous ? Math.max(now - previous.at, 1) : 0
  const kbps = (current: number, before: number): number => {
    if (!previous || elapsedMs <= 0) return 0
    return Math.round(((current - before) * 8) / elapsedMs)
  }

  return {
    diagnostics: {
      iceState: peer.iceConnectionState,
      connectionState: peer.connectionState,
      candidateType: localCandidate ? candidateKind(localCandidate) : 'unknown',
      relayProtocol: localCandidate ? str(localCandidate, 'relayProtocol') : '',
      rttMs,
      lossPercent: percent(packetsLost, total),
      remoteLossPercent: percent(remotePacketsLost, remoteTotal),
      availableOutgoingKbps: pair ? Math.round(num(pair, 'availableOutgoingBitrate') / 1000) : 0,
      qualityLimitation,
      jitterBufferDelayMs:
        jitterBufferEmitted > 0 ? Math.round((jitterBufferDelay / jitterBufferEmitted) * 1000) : 0,
      framesDropped,
      freezeCount,
      nackCount,
      jitterMs: Math.round(jitterSeconds * 1000),
      inboundKbps: kbps(bytesReceived, previous?.bytesReceived ?? 0),
      outboundKbps: kbps(bytesSent, previous?.bytesSent ?? 0),
      codecs: Array.from(codecs).sort()
    },
    sample: { bytesReceived, bytesSent, at: now }
  }
}

/** Доля (в процентах) с одним знаком после запятой; нулевой знаменатель — 0. */
function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

/**
 * Насколько «серьёзна» причина ограничения отправки.
 *
 * В отчёте причин несколько (по одной на поток) — оставляем ту, что хуже всего
 * объясняет проблему: процессор и полоса важнее прочих.
 */
function reasonPreference(reason: string): number {
  if (reason === 'cpu') return 3
  if (reason === 'bandwidth') return 2
  if (reason === 'other') return 1
  return 0
}

/**
 * Качество связи «одним взглядом»: потери и задержка важнее скорости.
 *
 * Пороги намеренно мягкие: мобильная сеть почти всегда даёт потери, а показывать
 * «плохо» на каждой заминке — значит приучать игнорировать индикатор.
 */
export function connectionQuality(diagnostics: CallDiagnostics | null): ConnectionQuality {
  if (!diagnostics) return 'good'
  // Худшее из направлений: потери «к нам» и потери нашего потока у собеседника.
  const loss = Math.max(diagnostics.lossPercent, diagnostics.remoteLossPercent)
  if (loss >= 8 || diagnostics.rttMs >= 600) return 'bad'
  if (loss >= 3 || diagnostics.rttMs >= 300) return 'fair'
  return 'good'
}

/** Короткая подпись для бейджа: куда идёт медиа и как оно себя чувствует. */
export function diagnosticsSummary(diagnostics: CallDiagnostics | null): string {
  if (!diagnostics) return ''
  const route =
    diagnostics.candidateType === 'relay'
      ? `через релей${diagnostics.relayProtocol ? ` (${diagnostics.relayProtocol})` : ''}`
      : diagnostics.candidateType === 'srflx'
        ? 'напрямую через NAT'
        : 'напрямую'
  const loss = diagnostics.lossPercent > 0 ? `, потери ${diagnostics.lossPercent}%` : ''
  return `${route} · ${diagnostics.rttMs} мс${loss}`
}
