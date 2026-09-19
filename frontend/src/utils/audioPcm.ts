/**
 * Звук для распознавания речи: загрузка записи и приведение её к виду, который
 * ждёт распознаватель.
 *
 * Нужно двоим: браузерному распознаванию (`utils/voiceRecognition.ts`, ему нужен
 * `AudioBuffer`) и нативному в Android (`services/nativeSpeech.ts`, ему нужен
 * «сырой» PCM 16 бит, моно, 16 кГц — системный распознаватель не понимает ни
 * wav, ни ogg).
 *
 * Отсюда же берётся усиление тихой записи: «записал тихо» — частая причина
 * пропущенных слов, а распознавателю всё равно, откуда звук пришёл.
 */

/** Частота, которую ждёт системный распознаватель Android. */
export const PCM_SAMPLE_RATE = 16000

/** Во сколько раз максимум усиливаем тихую запись (вместе с речью растёт и шум). */
const MAX_GAIN = 8

/** До какого уровня поднимаем тихую запись (доля от полной шкалы). */
const TARGET_PEAK = 0.5

/** Ниже этого уровня запись считаем тихой и усиливаем. */
const QUIET_PEAK = 0.5

/** Конструктор офлайн-рендера (в Safari — с префиксом). */
const offlineCtor = (): typeof OfflineAudioContext | null => {
  if (typeof OfflineAudioContext !== 'undefined') return OfflineAudioContext
  const legacy = globalThis as unknown as {
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
  return legacy.webkitOfflineAudioContext ?? null
}

/**
 * Загружает и декодирует запись, усиливая тихую.
 *
 * Нормализация по пику: если пик записи 0.05 от шкалы, распознаватель «не слышит»
 * слова — домножаем до 0.5, но не больше ×8, чтобы не поднять шум вместе с речью.
 */
export async function loadAudioBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`Не удалось загрузить голосовое (${response.status})`)
  const data = await response.arrayBuffer()
  const buffer = await ctx.decodeAudioData(data)

  let peak = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel)
    // Пик ищем по каждому 20-му сэмплу: для оценки уровня этого достаточно, а
    // перебор десятков миллионов значений заметно тормозил бы интерфейс.
    for (let index = 0; index < samples.length; index += 20) {
      const value = Math.abs(samples[index])
      if (value > peak) peak = value
    }
  }
  if (peak > 0 && peak < QUIET_PEAK) {
    const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak)
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel)
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = clampSample(samples[index] * gain)
      }
    }
  }
  return buffer
}

/** Не выходим за пределы шкалы: переполнение распознаватель слышит как треск. */
const clampSample = (value: number): number => Math.max(-1, Math.min(1, value))

/**
 * Сводит запись в моно и приводит к 16 кГц в виде PCM 16 бит.
 *
 * Пересчёт частоты делает граф браузера (у него для этого есть фильтры), а если
 * офлайн-рендера нет (тесты, древний движок) — линейная интерполяция: для речи
 * этого достаточно, а тишина вместо звука была бы хуже.
 */
export async function toPcm16Mono16k(buffer: AudioBuffer): Promise<Int16Array> {
  const mono = await toMono16k(buffer)
  const pcm = new Int16Array(mono.length)
  for (let index = 0; index < mono.length; index += 1) {
    // 32767, а не 32768: значение ±1 должно оставаться представимым.
    pcm[index] = Math.round(clampSample(mono[index]) * 32767)
  }
  return pcm
}

/** Моно-дорожка в 16 кГц (без упаковки в 16 бит). */
async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const Ctor = offlineCtor()
  if (Ctor !== null && buffer.length > 0) {
    const length = Math.max(1, Math.round((buffer.length / buffer.sampleRate) * PCM_SAMPLE_RATE))
    try {
      const offline = new Ctor(1, length, PCM_SAMPLE_RATE)
      const source = offline.createBufferSource()
      source.buffer = buffer
      source.connect(offline.destination)
      source.start()
      const rendered = await offline.startRendering()
      return rendered.getChannelData(0)
    } catch {
      /* нет офлайн-рендера — считаем сами (см. ниже) */
    }
  }
  return linearResample(buffer)
}

/** Линейная интерполяция в моно 16 кГц (запасной путь). */
function linearResample(buffer: AudioBuffer): Float32Array {
  const ratio = buffer.sampleRate / PCM_SAMPLE_RATE
  const length = Math.max(1, Math.round(buffer.length / ratio))
  const output = new Float32Array(length)
  const channels: Float32Array[] = []
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel))
  }
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const low = Math.min(channels[0].length - 1, Math.floor(position))
    const high = Math.min(channels[0].length - 1, low + 1)
    const fraction = position - low
    let sum = 0
    for (const samples of channels) {
      sum += samples[low] + (samples[high] - samples[low]) * fraction
    }
    output[index] = sum / channels.length
  }
  return output
}

/** base64 из байтов (без Node-буферов: код исполняется в браузере). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Частями по 32 КБ: `apply` на целом массиве упирается в предел по числу
  // аргументов и падает на длинной записи.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/**
 * Режет PCM на куски base64.
 *
 * Частями, а не целиком: одним вызовом большой файл не пролезет — у вызова из
 * страницы в нативную часть есть предел по размеру строки.
 */
export function pcmChunks(pcm: Int16Array, chunkBytes: number): string[] {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const size = Math.max(2, chunkBytes - (chunkBytes % 2))
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + size)))
  }
  return chunks
}

/**
 * Понятный текст ошибки подготовки звука.
 *
 * ГРАБЛЯ, которую тут и обходим: браузер отвечает на нечитаемую запись английским
 * `EncodingError: Unable to decode audio data`, и человек видел ровно это вместо
 * причины («файл повреждён»). Русские сообщения от `loadAudioBuffer` (например,
 * «Не удалось загрузить голосовое (404)») оставляем как есть.
 */
export function describeAudioError(thrown: unknown): string {
  const name = thrown instanceof Error ? thrown.name : ''
  const text = thrown instanceof Error ? thrown.message : String(thrown ?? '')
  if (name === 'EncodingError' || /decode/i.test(text)) {
    return 'Запись не удалось прочитать — возможно, файл повреждён'
  }
  return text || 'Не удалось распознать голосовое'
}
