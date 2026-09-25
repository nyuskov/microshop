/**
 * Расшифровка голосовых распознавателем УСТРОЙСТВА (Android-обёртка).
 *
 * Зачем: в WebView API распознавания речи нет вовсе, поэтому в приложении кнопки
 * «В текст» не было. Нативная часть принимает звук страницы и отдаёт его
 * системному распознавателю как файл (`RecognizerIntent.EXTRA_AUDIO_SOURCE`),
 * а результат присылает событием `pismo:speech`.
 *
 * Что страница готовит сама: «сырой» PCM 16 бит, моно, 16 кГц — контейнеры
 * (wav/ogg) системный распознаватель не понимает. Поэтому звук декодируется и
 * пересчитывается в `utils/audioPcm.ts`, а потом уходит в нативную часть кусками
 * в base64 (одним вызовом большой файл не пролезет).
 *
 * Приватность: если в системе есть распознаватель «на устройстве», звук никуда не
 * отправляется. Если его нет — используется обычный системный, и это уже решение
 * системы: под расшифровкой об этом честно написано.
 */

import { isNativeApp, nativeBridge } from './nativePush'
import { t } from '@/i18n'
import {
  describeAudioError,
  loadAudioBuffer,
  pcmChunks,
  toPcm16Mono16k,
  trimSilencePcm
} from '@/utils/audioPcm'

/** Сколько байт PCM отдаём нативному слою за один вызов (~6 с записи). */
export const NATIVE_CHUNK_BYTES = 192 * 1024

/** Сколько ждём ответ нативного слоя, прежде чем считать это сбоем. */
const ANSWER_TIMEOUT_MS = 120 * 1000

/** Итог расшифровки — тот же вид, что и у браузерного пути. */
export interface NativeSpeechResult {
  status: 'ready' | 'failed'
  text: string
  error?: string
}

/** Что приходит в событии `pismo:speech`. */
interface NativeSpeechDetail {
  id?: string
  status?: string
  text?: string
  error?: string
}

/**
 * Отмены по сообщению: контракт тот же, что у браузерного распознавания, поэтому
 * `stopRecognition()` работает и здесь (уход из чата, повторный запуск).
 */
const cancels = new Map<number, () => void>()

/** Есть ли в этой оболочке нативное распознавание записей. */
export function nativeSpeechSupported(): boolean {
  if (!isNativeApp()) return false
  const bridge = nativeBridge()
  if (!bridge?.speechSupported || !bridge.speechBegin || !bridge.speechChunk) return false
  try {
    return bridge.speechSupported() === true
  } catch {
    return false
  }
}

/**
 * Расшифровывает запись нативным распознавателем.
 *
 * `onPartial` зовётся по мере чтения: у длинной записи текст виден до конца.
 */
export async function recognizeWithNative(
  messageId: number,
  src: string,
  language: string,
  onPartial: (text: string) => void
): Promise<NativeSpeechResult> {
  const bridge = nativeBridge()
  if (!bridge?.speechBegin || !bridge.speechChunk) {
    return {
      status: 'failed',
      text: '',
      error: t('Распознавание недоступно на этом устройстве')
    }
  }

  const id = String(messageId)
  let done = false
  let cancelled = false
  let timer = 0
  let resolveResult: ((result: NativeSpeechResult) => void) | null = null

  function cleanup(): void {
    if (done) return
    done = true
    window.clearTimeout(timer)
    window.removeEventListener('pismo:speech', listener)
    cancels.delete(messageId)
  }

  function settle(result: NativeSpeechResult): void {
    if (done) return
    cleanup()
    resolveResult?.(result)
  }

  function listener(event: Event): void {
    const detail = (event as CustomEvent<NativeSpeechDetail>).detail ?? {}
    // Чужие расшифровки не трогаем: сообщений в ленте много.
    if (detail.id !== id) return
    if (detail.status === 'partial') {
      if (typeof detail.text === 'string') onPartial(detail.text)
      return
    }
    if (detail.status === 'ready') {
      settle({ status: 'ready', text: detail.text ?? '' })
      return
    }
    if (detail.status === 'failed') {
      settle({ status: 'failed', text: detail.text ?? '', error: detail.error })
    }
  }

  const finished = new Promise<NativeSpeechResult>((resolve) => {
    resolveResult = resolve
  })
  // Подписываемся ДО отправки звука: иначе быстрый ответ нативного слоя потерялся
  // бы — особенно на коротком голосовом.
  window.addEventListener('pismo:speech', listener)
  timer = window.setTimeout(() => {
    settle({
      status: 'failed',
      text: '',
      error: t('Распознавание не ответило')
    })
  }, ANSWER_TIMEOUT_MS)
  cancels.set(messageId, () => {
    cancelled = true
    // Просим нативную часть остановиться: она держит распознаватель и файл.
    bridge.speechCancel?.()
    settle({ status: 'failed', text: '', error: 'aborted' })
  })

  const ctx = new AudioContext()
  try {
    // Тот же грабли-пункт, что и в браузерном пути: контекст, созданный вне
    // жеста пользователя, остаётся `suspended` и не рендерит граф.
    if (ctx.state === 'suspended') await ctx.resume()
    const buffer = await loadAudioBuffer(ctx, src)
    // Тишину по краям срезаем и здесь: системный распознаватель ждёт тот же звук,
    // а на паузах в начале и конце он тоже склонен выдумывать слова.
    const pcm = trimSilencePcm(await toPcm16Mono16k(buffer))
    if (cancelled) {
      await ctx.close()
      return await finished
    }
    if (!bridge.speechBegin(id, language)) {
      settle({
        status: 'failed',
        text: '',
        error: t('Распознавание недоступно на этом устройстве')
      })
    } else {
      const chunks = pcmChunks(pcm, NATIVE_CHUNK_BYTES)
      if (!chunks.length) {
        settle({
          status: 'failed',
          text: '',
          error: t('Распознавание не получило звук')
        })
      }
      chunks.forEach((chunk, index) => {
        if (cancelled || done) return
        bridge.speechChunk?.(chunk, index === chunks.length - 1)
      })
    }
  } catch (thrown) {
    bridge.speechCancel?.()
    settle({
      status: 'failed',
      text: '',
      error: describeAudioError(thrown)
    })
  }

  const result = await finished
  await ctx.close()
  return result
}

/** Останавливает нативное распознавание этого сообщения. */
export function cancelNativeRecognition(messageId: number): void {
  const cancel = cancels.get(messageId)
  if (cancel) {
    cancel()
    return
  }
  // Ещё не успели зарегистрироваться (идёт подготовка звука) — просим нативную
  // часть остановиться напрямую.
  nativeBridge()?.speechCancel?.()
}
