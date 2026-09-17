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
 *   следующих, без переспроса и задержки;
 * - **DTX и моно**: в тишине пакеты почти не шлются, стерео не тратит полосу
 *   впустую;
 * - **видео уступает**: при потерях битрейт видео снижается ступенями, а
 *   картинка при этом сохраняет плавность (быстро меняющиеся кадры важнее
 *   резкости для разговора);
 * - **подсказки кодеку** (`contentHint`): речь, движение в камере и текст на
 *   экране оптимизируются по-разному.
 */

import type { CallDiagnostics } from '@/utils/callStats'

/**
 * Параметры Opus, которые важнее всего на плохой сети.
 *
 * `useinbandfec=1` — встроенная коррекция ошибок: к каждому пакету добавляется
 * избыточность, и потери до ~20 % слышны куда меньше. `usedtx=1` — в тишине
 * пакеты не шлются вовсе (освобождает полосу для собеседника). `stereo=0` и
 * `maxaveragebitrate=40000` — голос и так моно: платить за стерео нечем, но и
 * ужимать до «телефонного» качества незачем.
 * `minptime=10` — пакетирование по 10 мс: короче хвост задержки при дрожании.
 */
export const AUDIO_OPUS_PARAMS =
  'minptime=10;useinbandfec=1;usedtx=1;stereo=0;maxaveragebitrate=40000;maxplaybackrate=48000'

/** Целевой битрейт видео (бит/с) для разного качества связи. */
export const VIDEO_BITRATE_GOOD = 700_000
export const VIDEO_BITRATE_FAIR = 350_000
export const VIDEO_BITRATE_BAD = 140_000

/**
 * Предел полосы для звука: 40 кбит/с сам голос плюс запас на избыточность FEC и
 * служебные пакеты. При перегрузке канала видео режется раньше звука — за это
 * отвечают `priority`/`networkPriority` ниже.
 */
const AUDIO_MAX_BITRATE = 64_000

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

/** Целевой битрейт видео по текущему качеству связи. */
export function videoBitrateFor(diagnostics: CallDiagnostics | null): number {
  if (!diagnostics) return VIDEO_BITRATE_FAIR
  const { lossPercent, jitterMs, rttMs } = diagnostics
  // Потери и дрожание важнее задержки: именно они «съедают» голос.
  if (lossPercent >= 8 || jitterMs >= 90) return VIDEO_BITRATE_BAD
  if (lossPercent >= 2 || jitterMs >= 45 || rttMs >= 400) return VIDEO_BITRATE_FAIR
  return VIDEO_BITRATE_GOOD
}

/**
 * Настраивает передатчики: аудио — приоритетным и с малым битрейтом (качеству
 * голоса этого хватает), видео — на нужный битрейт с приоритетом ниже.
 */
export async function tuneSenders(
  connection: RTCPeerConnection,
  videoBitrate: number,
  options: { screen?: boolean } = {}
): Promise<void> {
  for (const sender of connection.getSenders()) {
    const kind = sender.track?.kind
    try {
      if (kind === 'audio') {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        for (const encoding of params.encodings) {
          encoding.maxBitrate = AUDIO_MAX_BITRATE
          // Приоритеты: браузер режет видео раньше, чем звук.
          encoding.priority = 'high'
          encoding.networkPriority = 'high'
        }
        await sender.setParameters(params)
      } else if (kind === 'video') {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        for (const encoding of params.encodings) {
          encoding.maxBitrate = videoBitrate
          encoding.priority = 'low'
          encoding.networkPriority = 'low'
        }
        // Разговор важнее резкости: при нехватке полосы пусть падает разрешение,
        // а не частота кадров (иначе картинка «замирает»). У показа экрана
        // наоборот — важнее читаемость текста. `getParameters()` это поле у
        // Chrome не отдаёт, поэтому выставляем безусловно.
        params.degradationPreference = options.screen ? 'maintain-resolution' : 'maintain-framerate'
        await sender.setParameters(params)
      }
    } catch {
      /* настройка не удалась — звонок продолжается на значениях по умолчанию */
    }
  }
}
