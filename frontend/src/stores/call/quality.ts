/**
 * Качество медиа в звонке: устойчивость к плохой сети.
 *
 * Междугородние разговоры (например, Москва — Россошь) идут через мобильные
 * сети и несколько операторов: потери пакетов и дрожание задержки там обычное
 * дело. Задача этого модуля — чтобы при плохой сети разговор оставался
 * разборчивым:
 *
 * - **звук вперёд**: аудио-линия получает высокий приоритет и встроенную
 *   помехоустойчивость (Opus FEC) — потерянные пакеты восстанавливаются из
 *   следующих, без переспроса и задержки; при потерях поток сужается ступенями
 *   (48 → 32 → 24 кбит/с), потому что крупные пакеты теряются чаще мелких;
 * - **DTX и моно**: в тишине пакеты почти не шлются, стерео не тратит полосу
 *   впустую;
 * - **видео уступает**: при потерях снижаются и битрейт, и разрешение, и
 *   частота кадров — «мыло» на полном кадре выглядит хуже, чем чистая картинка
 *   поменьше, а разговор важнее резкости;
 * - **показ экрана — особый случай**: текст мелкий и статичный, поэтому ему
 *   даётся высокий битрейт и `maintain-resolution`, и ступени сети на него не
 *   распространяются;
 * - **буфер воспроизведения** (`jitterBufferTarget`): меньше буфер — меньше
 *   задержка разговора, но буфер растёт с дрожанием, иначе звук пропадает;
 * - **подсказки кодеку** (`contentHint`): речь, движение в камере и текст на
 *   экране оптимизируются по-разному.
 *
 * Отдельно: в групповом звонке качество у собеседников разное, поэтому настройки
 * применяются к КАЖДОЙ связи по её собственной статистике (см. `_tuneLinksByStats`
 * в `stores/call.ts`), а не одной общей ступенью.
 */

import type { CallDiagnostics } from '@/utils/callStats'

/**
 * Параметры Opus, которые важнее всего на плохой сети.
 *
 * `useinbandfec=1` — встроенная коррекция ошибок: к каждому пакету добавляется
 * избыточность, и потери до ~20 % слышны куда меньше. `stereo=0` и
 * `maxaveragebitrate=48000` — голос и так моно, платить за стерео нечем, но и
 * ужимать до «телефонного» качества незачем. `stereo=0` и `sprop-stereo=0` идут
 * парой: первый выключает стерео у кодера, второй говорит об этом приёмнику.
 *
 * Чего здесь СОЗНАТЕЛЬНО нет: `usedtx=1`. Экономия тишины даётся дорого — на
 * стыках фраз слышны щелчки и «бульканье» (приёмник не успевает сгенерировать
 * комфортный шум). Плавность и разборчивость важнее пары процентов полосы.
 * `minptime` тоже не задаём: 20 мс (значение по умолчанию) — меньше пакетов и
 * меньше шансов получить потери на плохом канале.
 */
export const AUDIO_OPUS_PARAMS =
  'minptime=20;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=48000;maxplaybackrate=48000'

/** Целевой битрейт видео (бит/с) для разного качества связи. */
export const VIDEO_BITRATE_GOOD = 700_000
export const VIDEO_BITRATE_FAIR = 350_000
export const VIDEO_BITRATE_BAD = 140_000

/**
 * Целевой битрейт звука (бит/с) по качеству связи.
 *
 * 48 кбит/с — чистый голос, но на потерях крупные пакеты теряются чаще: сузив
 * поток до 32 и 24 кбит/с, разборчивость сохраняем лучше, чем «широким» звуком,
 * который рвётся. Потолок кодека задаёт SDP (`maxaveragebitrate`), а эти
 * ступени — реальный предел передатчика, он меняется без пересогласования.
 */
export const AUDIO_BITRATE_GOOD = 48_000
export const AUDIO_BITRATE_FAIR = 32_000
export const AUDIO_BITRATE_BAD = 24_000

/**
 * Показ экрана: текст мелкий, картинка статичная — ей нужен битрейт выше
 * «камерного» и свой предел кадров.
 *
 * Ступени качества сети на показ экрана НЕ применяются: ужать текст до
 * 140 кбит/с — значит сделать его нечитаемым, а экран человек показывает
 * осознанно и обычно недолго.
 */
export const SCREEN_BITRATE = 1_200_000
export const SCREEN_FRAMERATE = 15

/** Предел кадров/с для камеры по ступеням качества. */
export const VIDEO_FRAMERATE_GOOD = 30
export const VIDEO_FRAMERATE_FAIR = 24
export const VIDEO_FRAMERATE_BAD = 15

/** Целевые значения по ступеням связи: одна таблица — один источник правды. */
const AUDIO_BITRATE_BY_STEP: Record<QualityStep, number> = {
  good: AUDIO_BITRATE_GOOD,
  fair: AUDIO_BITRATE_FAIR,
  bad: AUDIO_BITRATE_BAD
}

const VIDEO_BITRATE_BY_STEP: Record<QualityStep, number> = {
  good: VIDEO_BITRATE_GOOD,
  fair: VIDEO_BITRATE_FAIR,
  bad: VIDEO_BITRATE_BAD
}

const VIDEO_SCALE_BY_STEP: Record<QualityStep, number> = { good: 1, fair: 1.5, bad: 2 }

const VIDEO_FRAMERATE_BY_STEP: Record<QualityStep, number> = {
  good: VIDEO_FRAMERATE_GOOD,
  fair: VIDEO_FRAMERATE_FAIR,
  bad: VIDEO_FRAMERATE_BAD
}

/**
 * Переписывает SDP: включает помехоустойчивые параметры Opus.
 *
 * Настройки Opus задаются только через SDP (`fmtp`) — отдельного API нет. Если
 * Opus в описании нет (другой кодек, изменённый формат), возвращаем описание
 * как есть: звонок важнее настройки.
 */
export function tuneOpusSdp(sdp: string): string {
  if (!sdp || !sdp.includes('opus/48000')) return sdp
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(newline)

  let payloadType = ''
  const rtpmapIndex = lines.findIndex((line) => {
    const match = /^a=rtpmap:(\d+) opus\/48000/i.exec(line)
    if (!match) return false
    payloadType = match[1]
    return true
  })
  if (rtpmapIndex === -1 || !payloadType) return sdp

  const fmtpIndex = lines.findIndex((line) => line.startsWith(`a=fmtp:${payloadType} `))
  const fmtp = `a=fmtp:${payloadType} ${AUDIO_OPUS_PARAMS}`
  if (fmtpIndex === -1) {
    // Описание без `fmtp` для Opus тоже бывает: строку добавляем сразу за rtpmap.
    lines.splice(rtpmapIndex + 1, 0, fmtp)
  } else {
    lines[fmtpIndex] = fmtp
  }
  return lines.join(newline)
}

/** Описание с настроенным Opus — его же отдаём собеседнику. */
export function tunedDescription(
  description: RTCSessionDescriptionInit
): RTCSessionDescriptionInit {
  if (!description.sdp) return description
  return { ...description, sdp: tuneOpusSdp(description.sdp) }
}

/** Подсказки кодекам: речь, движение или текст — оптимизации разные. */
export function applyTrackHints(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      // Уже заданную подсказку не перебиваем: у дорожки экрана она своя
      // («text»), и повторный вызов не должен превратить её в «motion».
      if (track.contentHint) continue
      if (track.kind === 'audio') track.contentHint = 'speech'
      else track.contentHint = 'motion'
    } catch {
      /* старые браузеры не знают contentHint — не критично */
    }
  }
}

/** Ступень качества связи, по которой выбираются настройки медиа. */
export type QualityStep = 'good' | 'fair' | 'bad'

/**
 * Определяет ступень по статистике связи.
 *
 * Берём худшее из двух направлений: потери на приёме и потери, о которых
 * сообщил собеседник (`remoteLossPercent` — это НАШ исходящий поток). На
 * мобильной сети проблема чаще именно в отправке, и по одному лишь приёму её не
 * увидеть. Доступная полоса (`availableOutgoingKbps`) — третий признак: если
 * оценка транспорта ниже того, что мы шлём, ступень понижается даже без потерь.
 */
export function qualityStepFor(diagnostics: CallDiagnostics | null): QualityStep {
  if (!diagnostics) return 'fair'
  const loss = Math.max(diagnostics.lossPercent, diagnostics.remoteLossPercent)
  const { jitterMs, rttMs, availableOutgoingKbps } = diagnostics
  const narrow = availableOutgoingKbps > 0
  // Потери и дрожание важнее задержки: именно они «съедают» голос.
  if (loss >= 8 || jitterMs >= 90 || (narrow && availableOutgoingKbps < 200)) return 'bad'
  if (loss >= 2 || jitterMs >= 45 || rttMs >= 400 || (narrow && availableOutgoingKbps < 450)) {
    return 'fair'
  }
  return 'good'
}

/**
 * Ступень качества для ВИДЕО.
 *
 * Отличается от сетевой одним случаем: кодер жалуется на ПРОЦЕССОР
 * (`qualityLimitation === 'cpu'`). Сеть тут ни при чём, а картинка «замирает» и
 * рассыпается — на слабом телефоне это заметнее потерь пакетов. Аудио кодируется
 * дёшево, поэтому его сужать нельзя: пострадает разборчивость речи. Облегчаем
 * ТОЛЬКО видео — до «среднего», а если сеть уже плохая, остаёмся на «плохой».
 */
export function videoStepFor(diagnostics: CallDiagnostics | null): QualityStep {
  const network = qualityStepFor(diagnostics)
  if (diagnostics?.qualityLimitation !== 'cpu') return network
  return stepRank(network) >= stepRank('fair') ? 'fair' : network
}

/** Целевой битрейт видео по текущему качеству связи. */
export function videoBitrateFor(diagnostics: CallDiagnostics | null): number {
  return VIDEO_BITRATE_BY_STEP[videoStepFor(diagnostics)]
}

/** Целевой битрейт звука по текущему качеству связи. */
export function audioBitrateFor(diagnostics: CallDiagnostics | null): number {
  return AUDIO_BITRATE_BY_STEP[qualityStepFor(diagnostics)]
}

/**
 * Во сколько раз уменьшать разрешение камеры (`scaleResolutionDownBy`).
 *
 * Одного битрейта мало: 140 кбит/с на 640×480 — это «мыло» и артефакты
 * движения. Ужав картинку до 480×360 и 320×240, тот же битрейт отдаёт заметно
 * более чистую картинку. На показ экрана не влияет (там всегда 1).
 */
export function videoScaleFor(diagnostics: CallDiagnostics | null): number {
  return VIDEO_SCALE_BY_STEP[videoStepFor(diagnostics)]
}

/** Предел кадров/с для камеры по качеству связи. */
export function videoFramerateFor(diagnostics: CallDiagnostics | null): number {
  return VIDEO_FRAMERATE_BY_STEP[videoStepFor(diagnostics)]
}

/** Порядок ступеней: чем больше, тем лучше связь. */
export function stepRank(step: QualityStep): number {
  if (step === 'good') return 2
  if (step === 'fair') return 1
  return 0
}

/**
 * Решает, применять ли новую ступень.
 *
 * Ухудшение — сразу: звук важнее красоты картинки. Улучшение — только выждав
 * паузу: на границе порогов ступень иначе «дышит» каждый опрос статистики (раз в
 * 5 с), и картинка то расширяется, то ужимается.
 */
export function resolveStep(
  current: QualityStep,
  next: QualityStep,
  sinceChangeMs: number,
  cooldownMs: number
): QualityStep {
  if (next === current) return current
  if (stepRank(next) < stepRank(current)) return next
  return sinceChangeMs >= cooldownMs ? next : current
}

/**
 * Пора ли приостанавливать видео — смотрим на ВСЕ связи.
 *
 * В групповом звонке плохая связь с одним собеседником (он в метро, у него 2G)
 * не повод гасить картинку остальным: каждому мы отправляем своим потоком, и
 * ступени у связей свои, так что хорошие связи продолжают получать видео. Гасим,
 * только когда плохо БОЛЬШИНСТВУ — это уже похоже на нашу собственную сеть.
 */
export function shouldPauseForQuality(steps: QualityStep[]): boolean {
  if (steps.length === 0) return false
  return steps.filter((step) => step === 'bad').length > steps.length / 2
}

/** Ступень качества словами (для панели диагностики). */
export function stepLabel(step: QualityStep): string {
  if (step === 'bad') return 'плохая'
  if (step === 'fair') return 'средняя'
  return 'хорошая'
}

/**
 * Одна строка о связи с участником — для панели диагностики в групповом звонке.
 *
 * `remoteLossPercent` — потери НАШЕГО потока на стороне собеседника: по ним
 * видно, что «нас плохо слышно», хотя у нас самих приём чистый.
 */
export function peerQualityLine(diagnostics: CallDiagnostics | null): string {
  if (!diagnostics) return 'нет данных'
  const parts = [`задержка ${diagnostics.rttMs} мс`]
  if (diagnostics.lossPercent > 0) parts.push(`приём: потери ${diagnostics.lossPercent}%`)
  if (diagnostics.remoteLossPercent > 0) {
    parts.push(`наш поток: потери ${diagnostics.remoteLossPercent}%`)
  }
  parts.push(`ступень: ${stepLabel(qualityStepFor(diagnostics))}`)
  return parts.join(' · ')
}

/** Целевые задержки буфера воспроизведения (мс). */
export interface JitterTargets {
  audioMs: number
  videoMs: number
}

/**
 * Цели буфера воспроизведения по дрожанию сети.
 *
 * Буфер по умолчанию браузер выбирает сам и часто «с запасом» — разговор идёт с
 * ощутимой задержкой, люди перебивают друг друга. Своя цель меньше, но растёт
 * вместе с дрожанием: на плохой сети маленький буфер даёт провалы в звуке.
 */
export function jitterTargetsFor(diagnostics: CallDiagnostics | null): JitterTargets {
  const jitter = Math.max(0, diagnostics?.jitterMs ?? 0)
  return {
    audioMs: Math.round(clamp(50 + jitter, 50, 140)),
    videoMs: Math.round(clamp(200 + jitter * 3, 200, 700))
  }
}

/** Ограничивает значение отрезком (дрожание в статистике бывает и нулевым). */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Настройки передатчиков одной связи. */
export interface SenderTuning {
  /** Предел битрейта звука (бит/с). */
  audioBitrate: number
  /** Предел битрейта видео (бит/с). */
  videoBitrate: number
  /** Во сколько раз уменьшать разрешение (1 — полное). */
  scale: number
  /** Предел кадров/с для видео (0 — не задавать). */
  framerate: number
  /** Идёт показ экрана: свои битрейт, кадры, деградация и разрешение. */
  screen?: boolean
}

/**
 * Настройки передатчиков для ступени связи.
 *
 * Показ экрана — отдельный режим: он ступеням не подчиняется (текст должен
 * оставаться читаемым), но звук продолжает сужаться вместе со связью — в
 * разговоре важен именно он.
 *
 * `videoStep` — своя ступень для ВИДЕО (`videoStepFor`): она ниже сетевой, когда
 * картинку ограничивает процессор. Звук при этом остаётся на сетевой ступени.
 */
export function senderTuningForStep(
  step: QualityStep,
  screen = false,
  videoStep: QualityStep = step
): SenderTuning {
  const audioBitrate = AUDIO_BITRATE_BY_STEP[step]
  if (screen) {
    return {
      audioBitrate,
      videoBitrate: SCREEN_BITRATE,
      scale: 1,
      framerate: SCREEN_FRAMERATE,
      screen: true
    }
  }
  return {
    audioBitrate,
    videoBitrate: VIDEO_BITRATE_BY_STEP[videoStep],
    scale: VIDEO_SCALE_BY_STEP[videoStep],
    framerate: VIDEO_FRAMERATE_BY_STEP[videoStep]
  }
}

/**
 * Настройки до первой статистики: битрейт средний, картинку НЕ ухудшаем.
 *
 * Ужимать разрешение без доказательств нельзя: первый опрос приходит через
 * несколько секунд после начала разговора, а портить картинку «на всякий
 * случай» незачем.
 */
export function initialSenderTuning(screen = false): SenderTuning {
  if (screen) {
    return {
      audioBitrate: AUDIO_BITRATE_GOOD,
      videoBitrate: SCREEN_BITRATE,
      scale: 1,
      framerate: SCREEN_FRAMERATE,
      screen: true
    }
  }
  return {
    audioBitrate: AUDIO_BITRATE_GOOD,
    videoBitrate: VIDEO_BITRATE_FAIR,
    scale: 1,
    framerate: 0
  }
}

/**
 * Настраивает передатчики: звук — приоритетным и с малым битрейтом (качеству
 * голоса этого хватает), видео — на нужный битрейт с приоритетом ниже.
 */
export async function tuneSenders(
  connection: RTCPeerConnection,
  tuning: SenderTuning
): Promise<void> {
  for (const sender of connection.getSenders()) {
    const kind = sender.track?.kind
    try {
      if (kind === 'audio') {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        for (const encoding of params.encodings) {
          encoding.maxBitrate = tuning.audioBitrate
          // Приоритеты: браузер режет видео раньше, чем звук.
          encoding.priority = 'high'
          encoding.networkPriority = 'high'
        }
        await sender.setParameters(params)
      } else if (kind === 'video') {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        for (const encoding of params.encodings) {
          encoding.maxBitrate = tuning.screen ? SCREEN_BITRATE : tuning.videoBitrate
          encoding.priority = 'low'
          encoding.networkPriority = 'low'
          // Разрешение ужимаем сами: иначе кодер отдаёт «мыло» на полном кадре.
          // У показа экрана разрешение не трогаем — текст должен быть резким.
          encoding.scaleResolutionDownBy = tuning.screen ? 1 : Math.max(1, tuning.scale)
          const fps = tuning.screen ? SCREEN_FRAMERATE : tuning.framerate
          if (fps > 0) encoding.maxFramerate = fps
        }
        // Разговор важнее резкости: при нехватке полосы пусть падает разрешение,
        // а не частота кадров (иначе картинка «замирает»). У показа экрана
        // наоборот — важнее читаемость текста. `getParameters()` это поле у
        // Chrome не отдаёт, поэтому выставляем безусловно.
        params.degradationPreference = tuning.screen ? 'maintain-resolution' : 'maintain-framerate'
        await sender.setParameters(params)
      }
    } catch {
      /* настройка не удалась — звонок продолжается на значениях по умолчанию */
    }
  }
}

/**
 * Ставит цель буфера воспроизведения приёмникам.
 *
 * `jitterBufferTarget` — современное поле (Chrome), `playoutDelayHint` — более
 * старое (в секундах). Safari/iOS не знают ни того, ни другого: тогда просто
 * ничего не делаем, буфер остаётся браузерным по умолчанию.
 */
export function tuneReceivers(connection: RTCPeerConnection, targets: JitterTargets): void {
  if (typeof connection.getReceivers !== 'function') return
  for (const receiver of connection.getReceivers()) {
    const ms = receiver.track?.kind === 'video' ? targets.videoMs : targets.audioMs
    const target = receiver as RTCRtpReceiver & {
      jitterBufferTarget?: number
      playoutDelayHint?: number
    }
    try {
      target.jitterBufferTarget = ms
    } catch {
      /* браузер не знает поле — пробуем старое */
    }
    try {
      target.playoutDelayHint = ms / 1000
    } catch {
      /* и его не знает — не критично */
    }
  }
}
