/**
 * Блокировка собеседника открытого личного чата.
 *
 * Два вида блокировки: полная (переписка и звонки запрещены в обе стороны, чат
 * скрывается из списка) и мягкая — «не принимать звонки» (переписка и чат
 * остаются, запрещён только дозвон). Состояние ЧИТАЕМ С СЕРВЕРА: без этого
 * подписи в меню («Заблокировать»/«Разблокировать», «Не принимать звонки» /
 * «Принимать звонки») врали бы после перезагрузки страницы.
 *
 * Вынесено из `Messenger.vue`: это одна тема (кто заблокирован и что показывать в
 * меню), а мессенджер только связывает её с шапкой чата и списком диалогов.
 * Зависимости — геттерами: в `<script setup>` мессенджера они объявлены ниже
 * вызова, и обращение к ним на этапе setup дало бы TDZ.
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { Notify } from 'quasar'
import { t } from '@/i18n'

import { blockUser, fetchBlockState, unblockUser, type BlockState } from '@/services/moderation'
import { getErrorMessage } from '@/services/errors'
import { chatPeer } from '@/utils/user'
import type { Chat, ChatUser } from '@/types'

const NO_BLOCK: BlockState = { blocked: false, messagesAllowed: false }

export interface PeerBlockingDeps {
  /** Открытый чат (null — ничего не открыто). */
  selectedChat: () => Chat | null
  /** id открытого чата: он есть даже когда самого чата в списке ещё нет. */
  selectedChatId: () => number | null
  currentUserId: () => number | null
  /** Полная блокировка: убрать диалог с экрана (из списка и ленты сообщений). */
  dropChat: (chatId: number) => void
  /** Перечитать список чатов: блокировку сняли — диалог снова виден. */
  refreshChats: () => Promise<void> | void
}

export interface PeerBlockingApi {
  /** Состояние блокировки собеседника открытого чата. */
  peerBlockState: Ref<BlockState>
  /** Полная блокировка: в меню «Разблокировать», чат скрыт. */
  peerFullyBlocked: ComputedRef<boolean>
  /** Мягкая блокировка: в меню «Принимать звонки». */
  peerCallsBlocked: ComputedRef<boolean>
  /** Пункт меню «Заблокировать»/«Разблокировать». */
  blockSelectedPeer: () => Promise<void>
  /** Пункт меню «Не принимать звонки»/«Принимать звонки». */
  toggleSelectedPeerCalls: () => Promise<void>
  /** Снятие блокировки (полной или мягкой). */
  unblockPeer: (userId: number) => Promise<void>
  /** В списке заблокированных что-то изменили — обновить диалоги. */
  onBlockedUsersChanged: () => void
  /** Перечитать состояние (например, после возврата на вкладку). */
  refreshPeerBlockState: () => Promise<void>
}

export function usePeerBlocking(deps: PeerBlockingDeps): PeerBlockingApi {
  const peerBlockState = ref<BlockState>({ ...NO_BLOCK })
  const peerFullyBlocked = computed(
    () => peerBlockState.value.blocked && !peerBlockState.value.messagesAllowed
  )
  const peerCallsBlocked = computed(
    () => peerBlockState.value.blocked && peerBlockState.value.messagesAllowed
  )

  /** Собеседник открытого личного чата: в группе блокировать некого. */
  const selectedPeer = (): ChatUser | null => {
    const chat = deps.selectedChat()
    if (!chat || chat.is_group) return null
    return chatPeer(chat, deps.currentUserId()) ?? null
  }

  const resetState = (): void => {
    peerBlockState.value = { ...NO_BLOCK }
  }

  const refreshPeerBlockState = async (): Promise<void> => {
    const peer = selectedPeer()
    if (!peer) {
      resetState()
      return
    }
    try {
      peerBlockState.value = await fetchBlockState(peer.id)
    } catch {
      // Не удалось узнать — считаем, что блокировки нет: меню покажет действия,
      // а права всё равно проверяет сервер.
      resetState()
    }
  }

  // Следим И за id открытого чата, И за появлением самого чата в списке: при
  // открытии по ссылке (`?chat=40`) сначала есть только id, а чатов ещё нет — с
  // одним лишь id состояние не подгрузится, и меню покажет «Не принимать звонки»
  // там, где звонки уже запрещены.
  watch(
    () => [deps.selectedChatId(), deps.selectedChat()?.id ?? null],
    () => void refreshPeerBlockState(),
    { immediate: true }
  )

  /** Полная блокировка: диалог скрывается, переписка не доставляется. */
  const blockPeer = async (userId: number): Promise<void> => {
    if (userId === deps.currentUserId()) return
    try {
      await blockUser(userId)
      const chat = deps.selectedChat()
      if (chat) deps.dropChat(chat.id)
      await deps.refreshChats()
    } catch (error) {
      Notify.create({
        message: getErrorMessage(error, t('Не удалось заблокировать пользователя')),
        color: 'negative',
        timeout: 4000
      })
    }
  }

  /**
   * Пункт меню у открытого чата.
   *
   * Если человек уже заблокирован полностью — этот же пункт снимает блокировку
   * (подпись в меню меняется на «Разблокировать»).
   */
  const blockSelectedPeer = async (): Promise<void> => {
    const peer = selectedPeer()
    if (!peer) return
    if (peerFullyBlocked.value) {
      await unblockPeer(peer.id)
      return
    }
    await blockPeer(peer.id)
  }

  /**
   * «Не принимать звонки» / «Принимать звонки» (мягкая блокировка).
   *
   * Частый случай: человек не хочет звонков от знакомого, но переписка нужна.
   * Полная блокировка тут слишком грубая — она вычёркивает и переписку, поэтому
   * чат не закрываем и ленту не чистим (это делает только `blockPeer`).
   */
  const toggleSelectedPeerCalls = async (): Promise<void> => {
    const peer = selectedPeer()
    if (!peer) return
    const userId = peer.id
    try {
      if (peerCallsBlocked.value) {
        // Уже запрещено — возвращаем звонки (мягкую блокировку снимаем целиком).
        await unblockUser(userId)
        resetState()
      } else {
        peerBlockState.value = await blockUser(userId, { messagesAllowed: true })
      }
    } catch (error) {
      Notify.create({
        message: getErrorMessage(error, t('Не удалось изменить запрет звонков')),
        color: 'negative',
        timeout: 4000
      })
    }
  }

  const unblockPeer = async (userId: number): Promise<void> => {
    try {
      await unblockUser(userId)
      resetState()
      await deps.refreshChats()
    } catch (error) {
      Notify.create({
        message: getErrorMessage(error, t('Не удалось снять блокировку')),
        color: 'negative',
        timeout: 4000
      })
    }
  }

  const onBlockedUsersChanged = (): void => {
    void deps.refreshChats()
  }

  return {
    peerBlockState,
    peerFullyBlocked,
    peerCallsBlocked,
    blockSelectedPeer,
    toggleSelectedPeerCalls,
    unblockPeer,
    onBlockedUsersChanged,
    refreshPeerBlockState
  }
}
