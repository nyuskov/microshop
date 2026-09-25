/**
 * Волна голосового сообщения: реальная громкость из самого файла.
 *
 * Зачем: раньше полоса проигрывания была плоской линией с бегунком — по ней
 * нельзя было понять, где в записи тихо, а где человек говорит громко. Владелец
 * (25.09.2026): «обозначение аудиозаписи сделай как фонограф, чтобы сила звука
 * была реальной». Теперь столбики считаются из звука: файл декодируется
 * (WebAudio), режется на равные доли, и высота каждого столбика — пик громкости
 * в этой доле.
 *
 * Особенности:
 * - декодируем через `OfflineAudioContext`: он работает без жеста пользователя
 *   (у `AudioContext` в Safari/Mobile Chrome автостарт запрещён, и волна молча не
 *   считалась бы);
 * - файл берём тем же `src`, что играет `<audio>`: для E2EE это уже
 *   расшифрованная `blob:`-ссылка (см. `useDecryptedMedia`), то есть звук никуда
 *   не уходит;
 * - результат кэшируем ПО id сообщения (файл декодируется один раз, сколько бы
 *   раз ни перерисовалась лента), ошибки тоже: битый файл не пытаемся разбирать
 *   повторно — плеер в этом случае остаётся с плоской полосой.
 */

/** Сколько столбиков рисуем. Как в МАКСе/Телеграме — примерно на всю ширину. */
export const WAVE_BARS = 36

/** Выше этого размера файл не разбираем: декодирование съест память без пользы. */
const MAX_DECODE_BYTES = 20 * 1024 * 1024

/** Сколько записей помним. Больше в открытом чате одновременно не бывает. */
const CACHE_LIMIT = 120

const cache = new Map<number, number[] | null>()
let decodeContext: OfflineAudioContext | null = null

/** Контекст для декодирования (без жеста пользователя — поэтому offline). */
const decoder = (): BaseAudioContext | null => {
  if (decodeContext) return decodeContext
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!Ctor) return null
  try {
    // Длина/частота для декодирования значения не имеют: мы только разбираем байты.
    decodeContext = new Ctor(1, 1, 44100)
  } catch {
    decodeContext = null
  }
  return decodeContext
}

/**
 * Пики громкости по долям: `bars` значений от 0 до 1 (1 — самый громкий момент).
 *
 * Каналы сводим в один (моно): показывать волну по каналам отдельно негде, а
 * брать только левый канал — потерять громкость, если звук записан справа.
 */
function peaksOf(buffer: AudioBuffer, bars: number): number[] {
  const channels = Math.max(1, buffer.numberOfChannels)
  const length = buffer.length
  const step = Math.max(1, Math.floor(length / bars))
  const mono = new Float32Array(length)
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) mono[i] += Math.abs(data[i]) / channels
  }
  const peaks: number[] = []
  let loudest = 0
  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * step
    const end = bar === bars - 1 ? length : Math.min(length, start + step)
    let peak = 0
    for (let i = start; i < end; i += 1) {
      if (mono[i] > peak) peak = mono[i]
    }
    peaks.push(peak)
    if (peak > loudest) loudest = peak
  }
  // Нормируем по самой громкой доле: тихая запись иначе была бы почти плоской.
  return loudest > 0 ? peaks.map((peak) => Math.min(1, peak / loudest)) : peaks
}

/** Убирает самую старую запись, когда кэш переполнен. */
function trimCache(): void {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) return
    cache.delete(oldest)
  }
}

/**
 * Пики волны для записи: `null` — посчитать не вышло (битый файл, нет WebAudio).
 *
 * Функция ничего не бросает: непосчитанная волна — не ошибка, плеер просто
 * покажет прежнюю плоскую полосу.
 */
export async function waveformPeaks(
  messageId: number,
  src: string,
  bars = WAVE_BARS
): Promise<number[] | null> {
  const cached = cache.get(messageId)
  if (cached !== undefined) return cached

  let result: number[] | null = null
  try {
    const context = decoder()
    if (context && src) {
      const response = await fetch(src)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 0 && bytes.byteLength <= MAX_DECODE_BYTES) {
        const decoded = await context.decodeAudioData(bytes)
        result = peaksOf(decoded, bars)
      }
    }
  } catch {
    result = null
  }

  cache.set(messageId, result)
  trimCache()
  return result
}

/** Сброс кэша: нужен тестам (в приложении кэш живёт весь сеанс). */
export function resetWaveformCache(): void {
  cache.clear()
}
