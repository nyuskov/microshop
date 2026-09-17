import { ICE_SERVERS as CONFIG_ICE_SERVERS, WS_ORIGIN } from '@/config'
import { fetchIceServers } from '@/services/iceServers'
import type { MicProcessing } from '@/utils/callDevices'

import { WS_PATH } from './constants'
import type { CallKind } from './types'

export const RELAY_ONLY_KEY = 'pismo_call_relay_only'

// «Лёгкое» видео: невысокое разрешение и частота — видеозвонок должен работать
// и через TURN-релей на мобильной сети (высокий битрейт 720p «валит» медиа,
// тогда как аудио-звонок проходит). Битрейт дополнительно режется кодом ниже.
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640, max: 640 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 24, max: 30 }
}

/**
 * Захват для группового звонка: плитка маленькая, а поток уходит КАЖДОМУ
 * участнику («mesh»). Меньший захват экономит и процессор телефона, и
 * исходящую полосу втрое.
 */
export const GROUP_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 480, max: 640 },
  height: { ideal: 360, max: 480 },
  frameRate: { ideal: 20, max: 24 }
}

/**
 * «Лестница» запасных форматов камеры.
 *
 * Камера может не уметь 640×480@24 — вместо отказа от видеозвонка пробуем
 * формат проще. Это частая причина «не удалось получить доступ к камере» на
 * дешёвых Android и при занятой камере (её отдаёт другое приложение в меньшем
 * разрешении).
 */
export const VIDEO_FALLBACKS: MediaTrackConstraints[] = [
  VIDEO_CONSTRAINTS,
  {
    width: { ideal: 480, max: 640 },
    height: { ideal: 360, max: 480 },
    frameRate: { ideal: 20, max: 24 }
  },
  {
    width: { ideal: 320, max: 480 },
    height: { ideal: 240, max: 360 },
    frameRate: { ideal: 15, max: 20 }
  }
]

/** Поля констрейнтов, которых может ещё не быть в типах этой версии TS. */
type ExtendedTrackConstraints = MediaTrackConstraints & {
  voiceIsolation?: boolean
  /** Желаемая задержка захвата, с (по спецификации — секунды). */
  latency?: number | { ideal?: number; max?: number }
}

/** Режим обработки микрофона объявлен рядом с настройками звонка. */
export type { MicProcessing }

// Аудиоконстрейнт: эхоподавление, шумодав и автоматический уровень — как в
// обычном разговоре. Обработку задаём явно: на части устройств браузерные
// значения по умолчанию дают «плавающую» громкость и гулкий звук.
// Моно: речь стерео не требует, а полусумма двух каналов на телефонах часто
// звучит тише и с фазовыми артефактами.
export const AUDIO_CONSTRAINTS: ExtendedTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  // 48 кГц — «родная» частота Opus: ресемплинг не нужен, голос чище.
  sampleRate: { ideal: 48000 },
  // Минимальная задержка захвата: она складывается с задержкой буфера вывода.
  latency: { ideal: 0.01 },
  // Выделение голоса из шума (Chrome 116+). Незнакомые констрейнты браузеры
  // игнорируют по спецификации, поэтому строка безопасна и для Safari.
  voiceIsolation: true
}

/**
 * Констрейнты звука под выбранный режим обработки.
 *
 * Автоуровень (`autoGainControl`) оставляем в обоих режимах — без него тихий
 * голос теряется. Выключается только шумодав: на части телефонов он делает
 * голос «роботом», и переключение даёт человеку выбор.
 */
export function micProcessingConstraints(mode: MicProcessing): MediaTrackConstraints {
  return mode === 'natural' ? { noiseSuppression: false } : { noiseSuppression: true }
}

/** Готовые констрейнты звука: устройство + режим обработки. */
export function audioConstraints(
  micId?: string,
  mode: MicProcessing = 'clean'
): ExtendedTrackConstraints {
  const constraints: ExtendedTrackConstraints = {
    ...AUDIO_CONSTRAINTS,
    ...micProcessingConstraints(mode)
  }
  if (micId) constraints.deviceId = { exact: micId }
  return constraints
}

// Демонстрация экрана: чёткость важнее плавности (текст мелкий), поэтому 15 fps.
export const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: { ideal: 15, max: 30 }
}

// ICE-серверы: TURN-креды приходят с бэкенда временными (см. services/iceServers.ts),
// если сервер не ответил — работаем по STUN из config (звонок важнее свежих кредов).
// Точка обновления — перед каждым звонком (`_iceConfiguration()`).
let iceConfiguration: RTCConfiguration = { iceServers: CONFIG_ICE_SERVERS }

/** Готовит конфигурацию ICE: тянет свежие TURN-креды под текущего пользователя. */
export async function loadIceConfiguration(): Promise<RTCConfiguration> {
  const servers = await fetchIceServers()
  // Напрямую не получилось в прошлый раз — идём только через релей (TURN).
  // Без TURN в списке так делать нельзя: остались бы без кандидатов вообще.
  const relayOnly = relayOnlyEnabled() && hasTurnServer(servers)
  iceConfiguration = {
    iceServers: servers,
    // Кандидаты собираем заранее — соединение поднимается на секунду-две быстрее.
    iceCandidatePoolSize: 4,
    // Все потоки идут по одному транспорту (меньше ICE-проверок и пересогласований),
    // а RTCP обязательно мультиплексируется с RTP.
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    ...(relayOnly ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {})
  }
  return iceConfiguration
}

/** Помним ли, что в прошлый раз помог только релей. */
function relayOnlyEnabled(): boolean {
  try {
    return window.localStorage.getItem(RELAY_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

/** Запомнить/забыть «только через релей» (private-режим просто не помнит). */
export function setRelayOnly(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(RELAY_ONLY_KEY, '1')
    else window.localStorage.removeItem(RELAY_ONLY_KEY)
  } catch {
    /* приватный режим — не страшно */
  }
}

/** Есть ли среди ICE-серверов TURN (без него режим «только релей» бесполезен). */
function hasTurnServer(servers: RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
    return urls.some(
      (url) => typeof url === 'string' && url.trim().toLowerCase().startsWith('turn')
    )
  })
}

/**
 * Идёт ли от потока живая дорожка нужного типа.
 *
 * У удалённой дорожки признак `muted` снимается только когда пошли данные:
 * поэтому решать «есть ли видео у собеседника» надо по живой дорожке, а не по
 * флагу из сигналинга (тот приходит отдельным сообщением и может отставать).
 */
export function hasLiveTrack(stream: MediaStream, kind: 'audio' | 'video'): boolean {
  return stream
    .getTracks()
    .some((track) => track.kind === kind && track.readyState === 'live' && !track.muted)
}

/**
 * Понятный текст ошибки доступа к камере/микрофону.
 *
 * Советы в разных случаях разные: запрет в браузере, нет устройства, «занято
 * другим приложением» (частый случай на Android). Раньше на всё был один текст
 * «Не удалось получить доступ к камере/микрофону», и человек не знал, что делать.
 */
export function mediaErrorMessage(error: unknown, kind: CallKind): string {
  const name = error instanceof Error ? error.name : ''
  const subject = kind === 'video' ? 'камере и микрофону' : 'микрофону'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Доступ к ${subject} запрещён — разрешите его в настройках браузера`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    const device = kind === 'video' ? 'камеру и микрофон' : 'микрофон'
    return `Не нашлось подходящего устройства: проверьте ${device}`
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Камера или микрофон заняты другим приложением — закройте его и попробуйте снова'
  }
  return `Не удалось получить доступ к ${subject}`
}

export function socketUrl(token: string): string {
  return `${WS_ORIGIN}${WS_PATH}?token=${encodeURIComponent(token)}`
}

export function stopAllTracks(stream: MediaStream | null | undefined) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

/** Заменяет в потоке дорожку того же вида (камера/микрофон) новой. */
export function swapTrackInStream(
  stream: MediaStream | null,
  track: MediaStreamTrack | null,
  kind: 'audio' | 'video'
) {
  if (!stream) return
  stream.getTracks().forEach((existing) => {
    if (existing.kind === kind && existing !== track) {
      stream.removeTrack(existing)
    }
  })
  if (track && !stream.getTracks().includes(track)) {
    stream.addTrack(track)
  }
}

/** Что можно попросить при захвате медиа для звонка. */
export interface MediaConstraintOptions {
  /** Групповой звонок: захват видео поменьше (поток уходит каждому). */
  group?: boolean
  /** Режим обработки микрофона. */
  micProcessing?: MicProcessing
}

/**
 * Ошибка, после которой перебирать форматы бессмысленно.
 *
 * Запрет доступа и «устройство занято» не зависят от разрешения: повторный
 * запрос только покажет человеку лишний диалог и снова завершится отказом.
 */
function isFatalCaptureError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  return (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    name === 'NotReadableError' ||
    name === 'AbortError'
  )
}

/**
 * Захват камеры с «планом Б»: полный формат → проще → ещё проще.
 *
 * Устройство из настроек требуем только в первой попытке: если внешнюю камеру
 * выдернули или выбрали ту, которой уже нет, лучше взять любую другую, чем
 * остаться без видео.
 */
export async function acquireCameraStream(
  cameraId?: string,
  options: MediaConstraintOptions = {}
): Promise<MediaStream> {
  const ladder = options.group
    ? [GROUP_VIDEO_CONSTRAINTS, ...VIDEO_FALLBACKS.slice(1)]
    : VIDEO_FALLBACKS
  let lastError: unknown = null
  for (const [index, constraints] of ladder.entries()) {
    const video: MediaTrackConstraints = { ...constraints }
    if (cameraId && index === 0) video.deviceId = { exact: cameraId }
    try {
      return await navigator.mediaDevices.getUserMedia({ video })
    } catch (error) {
      lastError = error
      if (isFatalCaptureError(error)) throw error
    }
  }
  throw lastError ?? new Error('нет видеодорожки')
}

/** Итог захвата медиа: поток и режим, в котором звонок реально может идти. */
export interface AcquiredMedia {
  stream: MediaStream
  /** 'audio', если камера не подошла и звонок продолжается без видео. */
  kind: CallKind
  /** Почему не вышло с камерой (для подписи в интерфейсе). */
  videoFailed?: unknown
}

/**
 * Захват медиа для звонка: звук обязателен, видео — по возможности.
 *
 * Когда камеру так и не отдали (нет устройства, занята, формат не поддержан),
 * звонок НЕ срывается: возвращаем поток только со звуком и вид `audio`, чтобы
 * интерфейс перешёл в голосовой режим. Раньше это был отказ от звонка, хотя
 * разговаривать человек мог.
 */
export async function acquireLocalMedia(
  kind: CallKind,
  options: MediaConstraintOptions & { cameraId?: string; micId?: string } = {}
): Promise<AcquiredMedia> {
  const { cameraId, micId, group, micProcessing } = options
  const audio = audioConstraints(micId, micProcessing)
  if (kind !== 'video') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    return { stream, kind: 'audio' }
  }
  const ladder = group ? [GROUP_VIDEO_CONSTRAINTS, ...VIDEO_FALLBACKS.slice(1)] : VIDEO_FALLBACKS
  let lastError: unknown = null
  for (const [index, constraints] of ladder.entries()) {
    const video: MediaTrackConstraints = { ...constraints }
    if (cameraId && index === 0) video.deviceId = { exact: cameraId }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video })
      if (stream.getVideoTracks().length > 0) return { stream, kind: 'video' }
      lastError = lastError ?? new Error('нет видеодорожки')
    } catch (error) {
      lastError = error
      if (isFatalCaptureError(error)) throw error
    }
  }
  // Камера не далась — звонок без видео, но со звуком. Если и микрофон
  // недоступен, эта попытка бросит ошибку: тогда отказ от звонка оправдан.
  const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
  return { stream, kind: 'audio', videoFailed: lastError }
}

/**
 * Идёт ли от собеседника реальный медиапоток.
 *
 * Смотрим именно на принятые RTP-байты, а не на `iceConnectionState`: соединение
 * может числиться «подключённым», пока пакеты никуда не идут — тогда в звонке нет
 * ни звука, ни видео. Лечится это перезапуском ICE (то же делает ручное
 * переключение Wi-Fi↔LTE).
 */
export async function remoteMediaFlowing(pc: RTCPeerConnection): Promise<boolean> {
  const ice = pc.iceConnectionState
  if (ice !== 'connected' && ice !== 'completed') return false
  // Статистики нет (старый браузер) — не мешаем звонку и считаем, что всё идёт.
  if (typeof pc.getStats !== 'function') return true
  try {
    const stats = await pc.getStats()
    let flowing = false
    stats.forEach((report: { type?: string; bytesReceived?: number }) => {
      if (report.type !== 'inbound-rtp') return
      if (Number(report.bytesReceived ?? 0) > 0) flowing = true
    })
    return flowing
  } catch {
    // Статистику не получить — не трогаем живой звонок.
    return true
  }
}
