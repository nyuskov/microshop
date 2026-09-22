import { t } from '@/i18n'
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

/**
 * До какого уровня выравниваем запись по громкости речи (доля от шкалы).
 *
 * Считаем не по пику, а по среднеквадратичному: пик может дать один щелчок, и
 * тихая речь останется тихой — а на тихой записи распознаватель уверенно выдаёт
 * «похожие по звучанию» слова и целые повторы. Проверено живьём: выравнивание
 * глухой тихой записи до этого уровня убрало из расшифровки первые ошибки
 * («Путером я в столрана» → «утром я встал рано»), а одно только усиление по
 * пику не меняло ничего.
 */
const TARGET_RMS = 0.1

/** Во сколько раз максимум усиливаем тихую запись (вместе с речью растёт и шум). */
const MAX_GAIN = 16

/** Потолок по пику: выше него запись распознаётся с искажениями. */
const PEAK_CEILING = 0.95

/**
 * Ниже этой частоты звук срезаем: речи там нет, а мусора много.
 *
 * Гул, ветер, стук по корпусу телефона и дыхание у микрофона живут именно в самых
 * низких частотах, а распознавателю нужен голос. Срез мягкий (−3 дБ на 80 Гц),
 * поэтому голос (даже низкий мужской) не страдает: смысл несут гармоники, а не
 * основной тон.
 */
const HIGHPASS_HZ = 80

/** Конструктор офлайн-рендера (в Safari — с префиксом). */
const offlineCtor = (): typeof OfflineAudioContext | null => {
  if (typeof OfflineAudioContext !== 'undefined') return OfflineAudioContext
  const legacy = globalThis as unknown as {
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
  return legacy.webkitOfflineAudioContext ?? null
}

/**
 * Уровень звука: пик и среднеквадратичное (RMS) значение.
 *
 * Смотрим каждый 4-й отсчёт: для оценки уровня этого достаточно, а полный
 * перебор миллионов значений на длинной записи заметно тормозил бы интерфейс.
 */
export interface AudioLevel {
  peak: number
  rms: number
}

/** Уровень одного канала. */
export const audioLevel = (samples: Float32Array): AudioLevel => {
  let peak = 0
  let sum = 0
  let count = 0
  for (let index = 0; index < samples.length; index += 4) {
    const value = samples[index]
    const magnitude = Math.abs(value)
    if (magnitude > peak) peak = magnitude
    sum += value * value
    count += 1
  }
  return { peak, rms: count > 0 ? Math.sqrt(sum / count) : 0 }
}

/** Уровень записи целиком: пик — максимум по каналам, RMS — среднее по каналам. */
const bufferLevel = (buffer: AudioBuffer): AudioLevel => {
  let peak = 0
  let sum = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const level = audioLevel(buffer.getChannelData(channel))
    peak = Math.max(peak, level.peak)
    sum += level.rms * level.rms
  }
  const channels = Math.max(1, buffer.numberOfChannels)
  return { peak, rms: Math.sqrt(sum / channels) }
}

/**
 * Загружает и декодирует запись, выравнивая её громкость.
 *
 * Разные записи приходят с разным уровнем (кто-то говорит у самого микрофона,
 * кто-то в стороне). Распознавателю нужен один уровень: на тихой записи он
 * выдаёт похожие по звучанию слова и повторы, на громкой с переполнением —
 * треск. Поэтому тихую поднимаем, громкую приглушаем, но не больше, чем
 * позволяет пик.
 */
export async function loadAudioBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer> {
  const response = await fetch(src)
  if (!response.ok)
    throw new Error(t('Не удалось загрузить голосовое ({status})', { status: response.status }))
  const data = await response.arrayBuffer()
  const buffer = await ctx.decodeAudioData(data)

  const level = bufferLevel(buffer)
  if (level.rms > 0) {
    // Выравниваем всегда: так распознаватель получает записи одной громкости,
    // как бы близко человек ни держал микрофон.
    const gain = Math.min(
      MAX_GAIN,
      TARGET_RMS / level.rms,
      PEAK_CEILING / Math.max(level.peak, 1e-6)
    )
    if (Math.abs(gain - 1) > 0.01) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const samples = buffer.getChannelData(channel)
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = clampSample(samples[index] * gain)
        }
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
export async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.length === 0) return new Float32Array(0)
  const Ctor = offlineCtor()
  if (Ctor !== null) {
    const length = Math.max(1, Math.round((buffer.length / buffer.sampleRate) * PCM_SAMPLE_RATE))
    try {
      const offline = new Ctor(1, length, PCM_SAMPLE_RATE)
      const source = offline.createBufferSource()
      source.buffer = buffer
      source.connect(offline.destination)
      source.start()
      const rendered = await offline.startRendering()
      const mono = rendered.getChannelData(0)
      // ГРАБЛЯ: на части мобильных сборок Chrome офлайн-рендер отдаёт тишину,
      // хотя в записи звук есть (слышно по исходнику). Молча кормить
      // распознаватель тишиной нельзя: на ней он выдаёт целые «фразы» и повторы.
      // Если пусто, а в записи звук — пересчитываем сами (линейно).
      if (audioLevel(mono).peak > 0 || bufferLevel(buffer).peak === 0)
        return cutLowFrequencies(mono)
    } catch {
      /* нет офлайн-рендера — считаем сами (см. ниже) */
    }
  }
  return cutLowFrequencies(linearResample(buffer))
}

/**
 * Срезает низкие частоты фильтром Баттерворта второго порядка (80 Гц).
 *
 * Считаем сами, а не графом браузера: фильтр нужен и на запасном пути пересчёта
 * (линейная интерполяция), а граф там недоступен.
 */
function cutLowFrequencies(samples: Float32Array): Float32Array {
  const omega = (2 * Math.PI * HIGHPASS_HZ) / PCM_SAMPLE_RATE
  const cos = Math.cos(omega)
  // Q = 1/√2 — «ровная» характеристика без горба на срезе.
  const alpha = Math.sin(omega) / Math.SQRT2
  const b0 = (1 + cos) / 2
  const b1 = -(1 + cos)
  const b2 = (1 + cos) / 2
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index]
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    samples[index] = y0
  }
  return samples
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
 *
 * Про формат сказано не ради полноты: при ошибке воспроизведения того же файла
 * браузер отвечает кодом 4 («устройство не умеет играть этот формат»), и тогда
 * расшифровка падает по той же причине — обещать в этом случае «файл повреждён»
 * нечестно.
 */
export function describeAudioError(thrown: unknown): string {
  const name = thrown instanceof Error ? thrown.name : ''
  const text = thrown instanceof Error ? thrown.message : String(thrown ?? '')
  if (name === 'EncodingError' || /decode/i.test(text)) {
    return t(
      'Запись не удалось прочитать — файл повреждён или формат не поддерживается устройством'
    )
  }
  return text || t('Не удалось распознать голосовое')
}
