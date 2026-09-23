/**
 * «Поделиться» в приложение: приём содержимого и отправка в выбранный чат.
 *
 * Два источника, один путь обработки:
 *  * Android-оболочка присылает содержимое событием `pismo:share`
 *    (`services/nativeShare.ts`);
 *  * установленная PWA — Chrome открывает страницу с параметрами
 *    `title/text/url` (`share_target` в манифесте, `utils/shareTarget.ts`).
 *
 * Дальше одинаково: показываем превью, ждём выбора чата и отправляем. Само
 * шифрование и отправка остаются в ленте — сюда приходят две функции
 * (`sendText`, `sendFile`), чтобы сценарий не тянул в composable крипту.
 */

import { onScopeDispose, ref, type Ref } from 'vue'
import { Notify } from 'quasar'
import {
  MAX_SHARE_FILE_BYTES,
  clearNativeShare,
  initNativeShare,
  readNativeShareFile,
  type NativeShareDescriptor
} from '@/services/nativeShare'
import { getErrorMessage } from '@/services/errors'
import { shareTargetFromSearch, withoutShareTargetParams } from '@/utils/shareTarget'
import type { Chat } from '@/types'
import { t } from '@/i18n'

export interface UseNativeShareOptions {
  /** Человек уже вошёл: иначе «поделиться» придержим до входа. */
  isAuthenticated: () => boolean
  chats: () => Chat[]
  currentUserId: () => number | null
  selectedChatId: () => number | null
  /** Отправить текст в чат (шифрование — на стороне ленты). */
  sendText: (chatId: number, text: string) => Promise<void>
  /** Отправить файл с подписью (сжатие и шифрование — на стороне ленты). */
  sendFile: (chatId: number, file: File, caption: string) => Promise<void>
  refreshChats: () => Promise<void>
  /** Перечитать открытую ленту, если отправили в неё. */
  refreshThread: () => Promise<void>
}

export interface UseNativeShare {
  /** Что прислали: показывается в диалоге выбора чата (`null` — диалог закрыт). */
  descriptor: Ref<NativeShareDescriptor | null>
  /** Присланный файл (уже прочитанный), если он есть. */
  file: Ref<File | null>
  /** Превью картинки для диалога. */
  previewUrl: Ref<string | null>
  /** Идёт отправка — кнопки в диалоге заблокированы. */
  busy: Ref<boolean>
  /** Отложенное «поделиться» (нажали до входа) — забрать после авторизации. */
  releasePending: () => Promise<void>
  /** Закрыть диалог без отправки. */
  cancel: () => void
  /** Отправить присланное в выбранный чат. */
  send: (chatId: number) => Promise<void>
}

export function useNativeShare(options: UseNativeShareOptions): UseNativeShare {
  const descriptor = ref<NativeShareDescriptor | null>(null)
  const file = ref<File | null>(null)
  const previewUrl = ref<string | null>(null)
  const busy = ref(false)
  /** «Поделиться» нажали до входа — придержим, пока человек не войдёт. */
  let pending: NativeShareDescriptor | null = null

  /** Сбрасывает состояние диалога (нативную часть не трогает). */
  const resetState = () => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
    file.value = null
    descriptor.value = null
  }

  /** Закрывает диалог и освобождает содержимое в нативной части. */
  const discard = () => {
    resetState()
    clearNativeShare()
  }

  const cancel = () => {
    if (busy.value) return
    discard()
  }

  /** Принимает содержимое «поделиться» и готовит превью. */
  const acceptIncomingShare = async (incoming: NativeShareDescriptor) => {
    if (!options.isAuthenticated()) {
      pending = incoming
      return
    }
    resetState()
    descriptor.value = incoming
    if (!incoming.hasFile) return
    if (incoming.size > MAX_SHARE_FILE_BYTES) {
      Notify.create({
        type: 'warning',
        message: t('Файл слишком большой'),
        caption: t('Отправим только текст'),
        timeout: 4000
      })
      descriptor.value = { ...incoming, hasFile: false, size: 0 }
      return
    }
    try {
      const received = await readNativeShareFile(incoming)
      if (!received) return
      file.value = received
      if (received.type.startsWith('image/')) {
        previewUrl.value = URL.createObjectURL(received)
      }
    } catch (error) {
      console.error(t('Не удалось прочитать присланный файл:'), getErrorMessage(error))
    }
  }

  /** Отправляет принятое содержимое в выбранный чат. */
  const send = async (chatId: number) => {
    const target = descriptor.value
    if (!target || busy.value) return
    const text = target.text.trim()
    const attached = file.value
    if (!text && !attached) {
      discard()
      return
    }
    busy.value = true
    try {
      if (attached) await options.sendFile(chatId, attached, text)
      else await options.sendText(chatId, text)
      await options.refreshChats()
      if (options.selectedChatId() === chatId) await options.refreshThread()
      discard()
    } catch (error) {
      Notify.create({
        type: 'negative',
        message: t('Не удалось отправить'),
        caption: getErrorMessage(error),
        timeout: 4000
      })
    } finally {
      busy.value = false
    }
  }

  /** Забрать отложенное «поделиться» после входа. */
  const releasePending = async () => {
    if (!pending) return
    const held = pending
    pending = null
    await acceptIncomingShare(held)
  }

  const dispose = initNativeShare((incoming) => {
    void acceptIncomingShare(incoming)
  })
  onScopeDispose(dispose)

  // «Поделиться» из установленной PWA: Chrome дописал параметры в адрес.
  // Забираем их до первой отрисовки и сразу чистим адрес (они длинные и не должны
  // попасть в историю); если человек ещё не вошёл — диалог откроется после входа.
  const shareTargetPayload = shareTargetFromSearch(
    typeof window === 'undefined' ? '' : window.location.search
  )
  if (shareTargetPayload) {
    try {
      window.history.replaceState(
        window.history.state,
        '',
        withoutShareTargetParams(window.location.href)
      )
    } catch {
      /* история недоступна — адрес просто останется как есть */
    }
    void acceptIncomingShare({
      text: shareTargetPayload.text,
      subject: '',
      mime: '',
      name: '',
      size: 0,
      hasFile: false
    })
  }

  return {
    descriptor,
    file,
    previewUrl,
    busy,
    releasePending,
    cancel,
    send
  }
}
