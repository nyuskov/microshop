/**
 * Живая проверка медиа-тракта звонков в настоящем Chrome (ручной стенд, НЕ CI).
 *
 * Что делает: запускает headless Chrome с фейковой камерой и микрофоном,
 * открывает Vite-сервер приложения и ВЫПОЛНЯЕТ модули `stores/call/*` прямо в
 * браузере. Так проверяется то, чего не покрыть тестами на jsdom:
 *
 * 1. Chrome принимает наши констрейнты захвата (48 кГц, voiceIsolation, latency);
 * 2. политики ICE (bundlePolicy / rtcpMuxPolicy / пул кандидатов);
 * 3. мунж Opus (`minptime=20;useinbandfec=1`) НЕ ломает согласование — обе
 *    стороны обмениваются им в реальном offer/answer и соединяются;
 * 4. `setParameters` принимает ступени (битрейты, scaleResolutionDownBy,
 *    maxFramerate, degradationPreference) и они читаются обратно;
 * 5. `jitterBufferTarget`/`playoutDelayHint` у приёмников реально существуют;
 * 6. поля статистики (`remoteLossPercent`, `qualityLimitationReason`,
 *    `availableOutgoingBitrate`, `jitterBufferDelay`, `codecId`→кодеки) приходят
 *    от настоящего WebRTC-стека;
 * 7. уровень речи: Chrome отдаёт `audioLevel` только при выводе звука ЭЛЕМЕНТОМ,
 *    а наш измеритель (`stores/call/output.ts`) работает и при выводе через
 *    Web Audio — здесь это измеряется тон-генератором.
 *
 * Зачем: этим стендом найдены баги, которых не видно в jsdom (пропадающие кодеки
 * при `mimeType` → `codecId`, тишина без привязанного к элементу потока).
 *
 * Запуск (нужен поднятый dev-фронтенд; Chrome с фейковыми устройствами):
 *     docker compose -f ../docker-compose.dev.yaml up -d
 *     node frontend/scripts/qa-call-media.mjs
 *
 * Код возврата: 0 — всё сошлось, 1 — шаги не прошли, 2/3 — стенд не поднялся.
 * Скрипт меняет только /tmp (профиль Chrome) и ничего не пишет в проект.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/usr/bin/google-chrome'
const PORT = 9333
/** Vite dev-сервер приложения (не 8000 — там API). */
const ORIGIN = 'https://localhost:5173'
/** Профиль Chrome — свой на каждый запуск: иначе два стенда не поделят порт. */
const PROFILE = mkdtempSync(join(tmpdir(), 'qa-call-media-'))

/** Занят ли отладочный порт: предыдущий стенд мог не завершиться. */
async function debuggerPortBusy() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
      signal: AbortSignal.timeout(500)
    })
    return response.ok
  } catch {
    return false
  }
}

if (await debuggerPortBusy()) {
  console.error(
    `Отладочный порт ${PORT} занят — похоже, предыдущий запуск стенда ещё работает.\n` +
      `Завершите его (pkill -f remote-debugging-port=${PORT}) и повторите.`
  )
  rmSync(PROFILE, { recursive: true, force: true })
  process.exit(3)
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--ignore-certificate-errors',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('не удалось подключиться к Chrome'))
    })
    const cdp = new Cdp(ws)
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const pending = cdp.pending.get(message.id)
      if (!pending) return
      cdp.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    }
    return cdp
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ждём, пока Chrome поднимет отладочный порт. */
async function debuggerUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const data = await response.json()
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl
    } catch {
      /* Chrome ещё не готов */
    }
    await sleep(250)
  }
  throw new Error('Chrome не отвечает на отладочном порту')
}

/** Код, который выполняется в странице. */
const pageCode = `(async () => {
  const out = { ok: true, steps: [] }
  const step = (name, data) => out.steps.push(Object.assign({ name }, data))
  try {
    const media = await import('/src/stores/call/media.ts')
    const quality = await import('/src/stores/call/quality.ts')
    const stats = await import('/src/utils/callStats.ts')

    // 1. Захват: фейковая камера + констрейнты звука (48 кГц, voiceIsolation, latency).
    const clean = await media.acquireLocalMedia('video', { micProcessing: 'clean' })
    const videoTrack = clean.stream.getVideoTracks()[0]
    const audioTrack = clean.stream.getAudioTracks()[0]
    step('захват', {
      kind: clean.kind,
      video: videoTrack ? videoTrack.getSettings() : null,
      audio: audioTrack ? audioTrack.getSettings() : null,
      naturalNoiseSuppression: media.audioConstraints(undefined, 'natural').noiseSuppression,
      cleanNoiseSuppression: media.audioConstraints(undefined, 'clean').noiseSuppression
    })

    // 2. Политики ICE.
    const iceConfig = await media.loadIceConfiguration()
    const probe = new RTCPeerConnection(iceConfig)
    const config = probe.getConfiguration()
    step('ICE', {
      bundlePolicy: config.bundlePolicy,
      rtcpMuxPolicy: config.rtcpMuxPolicy,
      iceCandidatePoolSize: config.iceCandidatePoolSize
    })
    probe.close()

    // 3. Реальное согласование с мунжем Opus (обе стороны) — loopback.
    const A = new RTCPeerConnection({ iceServers: [] })
    const B = new RTCPeerConnection({ iceServers: [] })
    const pendingForB = []
    const pendingForA = []
    A.onicecandidate = (event) => {
      if (!event.candidate) return
      if (B.remoteDescription) B.addIceCandidate(event.candidate).catch(() => undefined)
      else pendingForB.push(event.candidate)
    }
    B.onicecandidate = (event) => {
      if (!event.candidate) return
      if (A.remoteDescription) A.addIceCandidate(event.candidate).catch(() => undefined)
      else pendingForA.push(event.candidate)
    }
    for (const track of clean.stream.getTracks()) A.addTrack(track, clean.stream)

    const offer = quality.tunedDescription(await A.createOffer())
    await A.setLocalDescription(offer)
    await B.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
    const answer = quality.tunedDescription(await B.createAnswer())
    await B.setLocalDescription(answer)
    await A.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
    for (const candidate of pendingForB) await B.addIceCandidate(candidate).catch(() => undefined)
    for (const candidate of pendingForA) await A.addIceCandidate(candidate).catch(() => undefined)

    const reached = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(A.connectionState), 10000)
      A.onconnectionstatechange = () => {
        if (A.connectionState === 'connected') {
          clearTimeout(timer)
          resolve('connected')
        }
      }
    })
    const fmtpOf = (pc) => {
      const match = pc.localDescription.sdp.match(/a=fmtp:\\d+ [^\\r\\n]+/)
      return match ? match[0] : ''
    }
    step('согласование с мунжем Opus', {
      state: reached,
      iceState: A.iceConnectionState,
      answerFmtp: fmtpOf(A),
      offerFmtp: fmtpOf(B)
    })

    // 4. Ступени передатчиков: Chrome должен принять и вернуть их обратно.
    const videoSender = () => A.getSenders().find((sender) => sender.track && sender.track.kind === 'video')
    const audioSender = () => A.getSenders().find((sender) => sender.track && sender.track.kind === 'audio')
    await quality.tuneSenders(A, quality.senderTuningForStep('bad'))
    const badVideo = videoSender().getParameters()
    const badAudio = audioSender().getParameters()
    await quality.tuneSenders(A, quality.senderTuningForStep('good'))
    const goodVideo = videoSender().getParameters()
    await quality.tuneSenders(A, quality.senderTuningForStep('bad', true))
    const screenVideo = videoSender().getParameters()
    step('ступени передатчиков', {
      badAudio: badAudio.encodings[0],
      badVideo: badVideo.encodings[0],
      badDegradation: badVideo.degradationPreference,
      goodVideo: goodVideo.encodings[0],
      screenVideo: screenVideo.encodings[0],
      screenDegradation: screenVideo.degradationPreference
    })

    // 5. Буфер приёмников (свойство существует и принимает значение).
    quality.tuneReceivers(B, quality.jitterTargetsFor({ jitterMs: 30 }))
    step('буфер приёмника', {
      targets: quality.jitterTargetsFor({ jitterMs: 30 }),
      actual: B.getReceivers().map((receiver) => ({
        kind: receiver.track ? receiver.track.kind : null,
        jitterBufferTarget: receiver.jitterBufferTarget,
        playoutDelayHint: receiver.playoutDelayHint
      }))
    })

    // 6. Статистика: новые поля должны приходить от настоящего стека.
    //    Смотрим ДВЕ стороны: у отправителя — наш аплинк и отправка, у
    //    получателя — приём, уровень звука и буфер воспроизведения.
    await new Promise((resolve) => setTimeout(resolve, 8000))
    const rawReport = await A.getStats()
    const samples = { rtp: null, codec: null, pair: null }
    rawReport.forEach((entry) => {
      if (!samples.rtp && entry.type === 'outbound-rtp' && entry.kind !== 'audio') samples.rtp = { ...entry }
      if (!samples.codec && entry.type === 'codec') samples.codec = { ...entry }
      if (!samples.pair && entry.type === 'candidate-pair' && entry.nominated) samples.pair = { ...entry }
    })
    step('статистика (сырое)', samples)

    for (const [side, pc] of [
      ['A (отправляет)', A],
      ['B (принимает)', B]
    ]) {
      const { diagnostics } = stats.collectDiagnostics(await pc.getStats(), pc, null)
      step('диагностика ' + side, {
        lossPercent: diagnostics.lossPercent,
        remoteLossPercent: diagnostics.remoteLossPercent,
        availableOutgoingKbps: diagnostics.availableOutgoingKbps,
        qualityLimitation: diagnostics.qualityLimitation,
        jitterBufferDelayMs: diagnostics.jitterBufferDelayMs,
        framesDropped: diagnostics.framesDropped,
        freezeCount: diagnostics.freezeCount,
        nackCount: diagnostics.nackCount,
        audioLevel: diagnostics.audioLevel,
        inboundKbps: diagnostics.inboundKbps,
        outboundKbps: diagnostics.outboundKbps,
        codecs: diagnostics.codecs,
        speaksByLevel: stats.speakingNow(diagnostics.audioLevel, false),
        stepFromStats: quality.qualityStepFor(diagnostics),
        connectionQuality: stats.connectionQuality(diagnostics)
      })
    }
    // 7. Порог «говорит»: у фейкового микрофона Chrome тишина, поэтому
    //    синтезируем тон и смотрим РЕАЛЬНЫЙ audioLevel на приёме — с ним и
    //    сравниваем пороги speakingNow.
    const ctx = new AudioContext()
    const destination = ctx.createMediaStreamDestination()
    const oscillator = ctx.createOscillator()
    const toneGain = ctx.createGain()
    oscillator.frequency.value = 440
    toneGain.gain.value = 0
    oscillator.connect(toneGain).connect(destination)
    oscillator.start()
    const toneTrack = destination.stream.getAudioTracks()[0]

    const C = new RTCPeerConnection({ iceServers: [] })
    const D = new RTCPeerConnection({ iceServers: [] })
    const pendingForD = []
    C.onicecandidate = (event) => {
      if (!event.candidate) return
      // Кандидаты приходят раньше описания у собеседника — придержим их,
      // иначе addIceCandidate бросит и соединение не поднимется вовсе.
      if (D.remoteDescription) D.addIceCandidate(event.candidate).catch(() => undefined)
      else pendingForD.push(event.candidate)
    }
    D.onicecandidate = (event) => {
      if (event.candidate) C.addIceCandidate(event.candidate).catch(() => undefined)
    }
    C.addTrack(toneTrack, destination.stream)
    const toneOffer = await C.createOffer()
    await C.setLocalDescription(toneOffer)
    await D.setRemoteDescription({ type: 'offer', sdp: toneOffer.sdp })
    const toneAnswer = await D.createAnswer()
    await D.setLocalDescription(toneAnswer)
    await C.setRemoteDescription({ type: 'answer', sdp: toneAnswer.sdp })
    for (const candidate of pendingForD) await D.addIceCandidate(candidate).catch(() => undefined)
    const toneState = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(C.connectionState), 8000)
      C.onconnectionstatechange = () => {
        if (C.connectionState === 'connected') {
          clearTimeout(timer)
          resolve('connected')
        }
      }
    })

    /** Меняем громкость тона и читаем уровень на приёме. */
    const measureLevel = async (value) => {
      toneGain.gain.value = value
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const report = await D.getStats()
      let bytes = 0
      // Где Chrome вообще отдаёт уровень звука: смотрим все записи с полями
      // уровня/энергии — от этого зависит, работает ли индикатор «говорит».
      const levels = []
      report.forEach((entry) => {
        if (entry.type === 'inbound-rtp') bytes += entry.bytesReceived || 0
        const keys = Object.keys(entry).filter((key) => /audiolevel|audioenergy|energy/i.test(key))
        if (keys.length) {
          const snapshot = { type: entry.type, kind: entry.kind }
          for (const key of keys) snapshot[key] = entry[key]
          levels.push(snapshot)
        }
      })
      const probe = stats.collectDiagnostics(report, D, null)
      return { level: probe.diagnostics.audioLevel, bytes, levels }
    }

    // ВАЖНО: Chrome считает audioLevel в пути ВОСПРОИЗВЕДЕНИЯ. Проверяем три
    // конфигурации вывода, как они бывают в приложении:
    //   1) только Web Audio, без элемента на плитке — АУДИО-группа;
    //   2) элемент играет (фолбэк, Web Audio не поднялся) — уровень даёт Chrome;
    //   3) элемент заглушён, звук играет Web Audio — видеозвонок и группа с видео.
    const remoteTrack = D.getReceivers().find(
      (receiver) => receiver.track && receiver.track.kind === 'audio'
    ).track

    const outputModule = await import('/src/stores/call/output.ts')
    outputModule.ensureCallOutput()
    outputModule.wireRemoteOutput(new MediaStream([remoteTrack]), 7)
    const measureAppLevel = async (value) => {
      toneGain.gain.value = value
      // Даём буферу воспроизведения проиграть остатки прежней громкости, иначе
      // максимум по окну поймает ещё громкие сэмплы.
      await new Promise((resolve) => setTimeout(resolve, 600))
      let max = 0
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        const level = outputModule.remoteLevels().get(7) ?? 0
        if (level > max) max = level
      }
      return max
    }
    // 1) Элемента нет вовсе — как в аудио-группе (у плитки нет видеоэлемента).
    const appNoElement = await measureAppLevel(0.5)

    // 2) Появился элемент и играет сам (фолбэк: Web Audio не готов).
    const sinkElement = document.createElement('audio')
    sinkElement.autoplay = true
    sinkElement.srcObject = new MediaStream([remoteTrack])
    document.body.appendChild(sinkElement)
    await sinkElement.play().catch(() => undefined)
    const viaElement = await measureLevel(0.5)
    const viaElementQuiet = await measureLevel(0.0004)

    // 3) Элемент привязан, но заглушён — звук играет Web Audio (наша обычная схема).
    sinkElement.muted = true
    const appLoud = await measureAppLevel(0.5)
    const appQuiet = await measureAppLevel(0.0004)

    /** Убираем тон и завершаем служебный контекст. */
    const stopTone = () => {
      try {
        outputModule.teardownCallOutput()
        oscillator.stop()
        void ctx.close()
      } catch {
        /* уже закрыто */
      }
    }

    const loud = viaElement
    const quiet = viaElementQuiet
    step('порог «говорит»', {
      toneState,
      onThreshold: stats.SPEAKING_LEVEL_ON,
      offThreshold: stats.SPEAKING_LEVEL_OFF,
      loudLevel: loud.level,
      loudBytes: loud.bytes,
      loudLevelEntries: loud.levels,
      loudStartsSpeaking: stats.speakingNow(loud.level, false),
      quietLevel: quiet.level,
      quietBytes: quiet.bytes,
      quietStartsSpeaking: stats.speakingNow(quiet.level, false),
      quietKeepsSpeaking: stats.speakingNow(quiet.level, true),
      // Наш собственный измеритель (приложение): уровень и решение «говорит».
      appReady: outputModule.remoteOutputReady(),
      appCount: outputModule.remoteOutputCount(),
      appNoElementLevel: appNoElement,
      appNoElementStartsSpeaking: stats.speakingNow(appNoElement, false),
      appLoudLevel: appLoud,
      appLoudStartsSpeaking: stats.speakingNow(appLoud, false),
      appQuietLevel: appQuiet,
      appQuietStartsSpeaking: stats.speakingNow(appQuiet, false),
      // Без элемента на плитке (аудио-группа) — уровень должен остаться живым.
      appNoElementLevel: appNoElement,
      appNoElementStartsSpeaking: stats.speakingNow(appNoElement, false)
    })
    stopTone()

    const collected = stats.collectDiagnostics(await A.getStats(), A, null)
    const diagnostics = collected.diagnostics
    step('диагностика', {
      lossPercent: diagnostics.lossPercent,
      remoteLossPercent: diagnostics.remoteLossPercent,
      availableOutgoingKbps: diagnostics.availableOutgoingKbps,
      qualityLimitation: diagnostics.qualityLimitation,
      jitterBufferDelayMs: diagnostics.jitterBufferDelayMs,
      framesDropped: diagnostics.framesDropped,
      freezeCount: diagnostics.freezeCount,
      nackCount: diagnostics.nackCount,
      audioLevel: diagnostics.audioLevel,
      codecs: diagnostics.codecs,
      speaksByLevel: stats.speakingNow(diagnostics.audioLevel, false),
      stepFromStats: quality.qualityStepFor(diagnostics),
      connectionQuality: stats.connectionQuality(diagnostics)
    })

    for (const track of clean.stream.getTracks()) track.stop()
    A.close()
    B.close()
  } catch (error) {
    out.ok = false
    out.error = error && error.stack ? error.stack : String(error)
  }
  return JSON.stringify(out)
})()`

async function main() {
  const url = await debuggerUrl()
  const cdp = await Cdp.connect(url)
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank'
  })
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true
  })

  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Page.navigate', { url: ORIGIN }, sessionId)
  await sleep(3000)

  const result = await cdp.send(
    'Runtime.evaluate',
    { expression: pageCode, awaitPromise: true, returnByValue: true },
    sessionId
  )

  if (result.exceptionDetails) {
    console.error('Ошибка в странице:', JSON.stringify(result.exceptionDetails, null, 2))
    return 2
  }
  const payload = JSON.parse(result.result.value)
  console.log(payload.ok ? '=== проверка прошла ===' : '=== ОШИБКА ===')
  for (const entry of payload.steps) {
    console.log(`\n[${entry.name}]`)
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'name') continue
      console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    }
  }
  if (!payload.ok) console.log('\n', payload.error)
  return payload.ok ? 0 : 1
}

const code = await main().catch((error) => {
  console.error(error)
  return 3
})
chrome.kill()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* профиль удалим как получится */
}
process.exit(code)
