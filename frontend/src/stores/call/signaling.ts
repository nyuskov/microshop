import type { StatsSample } from '@/utils/callStats'

import type { CallKind, SignalingMessage } from './types'

export interface PendingOffer {
  callId: string
  kind: CallKind
  sdp: string
}

export interface CallSignalingRuntime {
  socket: WebSocket | null
  peerConnection: RTCPeerConnection | null
  localMedia: MediaStream | null
  remoteMedia: MediaStream | null
  pendingOffer: PendingOffer | null
  screenTrack: MediaStreamTrack | null
  screenSender: RTCRtpSender | null
  shareReturnKind: CallKind
  renegotiateSeq: number
  incomingTimer: number | undefined
  incomingDeadline: number
  rejoinTimer: number | undefined
  iceRecoveryTimer: number | undefined
  iceRestartAttempts: number
  socketRetryTimer: number | undefined
  socketRetryDeadline: number
  isCaller: boolean
  lastAnswerSdp: string | null
  answerRetryTimer: number | undefined
  answerRetryAttempts: number
  mediaWatchdogTimer: ReturnType<typeof setInterval> | undefined
  mediaWatchdogFailures: number
  mediaWatchdogRestarts: number
  mediaWatchdogBusy: boolean
  iceRestartInFlight: boolean
  statsTimer: number | undefined
  statsSample: StatsSample | null
}

export const runtime: CallSignalingRuntime = {
  socket: null,
  peerConnection: null,
  localMedia: null,
  remoteMedia: null,
  pendingOffer: null,
  screenTrack: null,
  screenSender: null,
  shareReturnKind: 'video',
  renegotiateSeq: 0,
  incomingTimer: undefined,
  incomingDeadline: 0,
  rejoinTimer: undefined,
  iceRecoveryTimer: undefined,
  iceRestartAttempts: 0,
  socketRetryTimer: undefined,
  socketRetryDeadline: 0,
  isCaller: false,
  lastAnswerSdp: null,
  answerRetryTimer: undefined,
  answerRetryAttempts: 0,
  mediaWatchdogTimer: undefined,
  mediaWatchdogFailures: 0,
  mediaWatchdogRestarts: 0,
  mediaWatchdogBusy: false,
  iceRestartInFlight: false,
  statsTimer: undefined,
  statsSample: null
}

export function sendRuntimeMessage(message: SignalingMessage): boolean {
  if (runtime.socket && runtime.socket.readyState === WebSocket.OPEN) {
    runtime.socket.send(JSON.stringify(message))
    return true
  }
  return false
}
