import { ICE_SERVERS as CONFIG_ICE_SERVERS, WS_ORIGIN } from '@/config'
import { fetchIceServers } from '@/services/iceServers'

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

// «Лёгкий» аудиоконстрейнт: эхоподавление и шумодав — как в обычном разговоре.
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true
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
    iceCandidatePoolSize: 2,
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

/** Медиа-констрейнты с учётом выбранного в настройках устройства. */
export function mediaConstraints(
  kind: CallKind,
  cameraId?: string,
  micId?: string
): MediaStreamConstraints {
  const audio: MediaTrackConstraints = { ...AUDIO_CONSTRAINTS }
  if (micId) audio.deviceId = { exact: micId }
  if (kind !== 'video') return { audio, video: false }
  const video: MediaTrackConstraints = { ...VIDEO_CONSTRAINTS }
  if (cameraId) video.deviceId = { exact: cameraId }
  return { audio, video }
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
