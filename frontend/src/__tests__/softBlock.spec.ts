import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Раздельная блокировка: «не звонить, но писать».
 *
 * Полная блокировка вычёркивает человека целиком (переписка и звонки запрещены,
 * чат скрыт), а мягкая запрещает только дозвон. Разница легко теряется при
 * правках, поэтому проверяем и подписи в меню, и то, что сервис передаёт вид
 * блокировки на сервер, и что значки не «поехали» (имя иконки вне ICON_MAP
 * рисуется текстом).
 */
const SRC = path.resolve(import.meta.dirname, '..')
const source = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

describe('меню чата', () => {
  const header = source('components/messenger/ChatHeader.vue')

  it('предлагает «не принимать звонки» и меняет подпись на обратную', () => {
    expect(header).toContain("runChatAction('calls')")
    expect(header).toContain("callsBlocked ? t('Принимать звонки') : t('Не принимать звонки')")
    expect(header).toContain("(e: 'toggle-calls-block'): void")
  })

  it('при полной блокировке пункт про звонки скрыт, а блокировка становится разблокировкой', () => {
    expect(header).toContain('v-if="!blocked"')
    expect(header).toContain("blocked ? t('Разблокировать') : t('Заблокировать')")
  })

  it('иконки пункта есть в наборе (иначе нарисуется текстом)', () => {
    const icons = source('utils/icons.ts')
    for (const name of ['call', 'call_end']) {
      expect(icons).toContain(`${name}:`)
    }
  })
})

describe('сервис модерации', () => {
  const service = source('services/moderation.ts')

  it('передаёт вид блокировки и читает состояние', () => {
    expect(service).toContain('messages_allowed: options?.messagesAllowed ?? false')
    expect(service).toContain('fetchBlockState')
    expect(service).toContain('export interface BlockState')
    expect(service).toContain('export interface BlockedUser')
  })
})

describe('блокировка собеседника (composable)', () => {
  // Логика вынесена из `Messenger.vue` в `usePeerBlocking`: тема одна (кто
  // заблокирован и что показывать в меню), а мессенджер отдаёт ей открытый чат и
  // действия над списком диалогов. Проверяем владельца логики и связку в шапке.
  const blocking = source('composables/usePeerBlocking.ts')
  const view = source('views/Messenger.vue')

  it('знает состояние блокировки открытого чата, а не только факт нажатия', () => {
    expect(blocking).toContain('const peerBlockState = ref<BlockState>')
    expect(blocking).toContain('const peerFullyBlocked = computed(')
    expect(blocking).toContain('const peerCallsBlocked = computed(')
    expect(blocking).toContain('await fetchBlockState(peer.id)')
  })

  it('мягкая блокировка не закрывает чат: переписка остаётся', () => {
    // В toggleSelectedPeerCalls нет выкидывания чата из списка и очистки ленты —
    // это делает только полная блокировка (blockPeer через dropChat).
    const start = blocking.indexOf('const toggleSelectedPeerCalls')
    const body = blocking.slice(start, start + 1400)
    expect(body).not.toContain('chats.value = chats.value.filter')
    expect(body).not.toContain('dropChat(')
  })

  it('повторное нажатие «Заблокировать» при полной блокировке снимает её', () => {
    expect(blocking).toContain('if (peerFullyBlocked.value) {')
  })

  it('мессенджер отдаёт composable открытый чат и действия над списком', () => {
    expect(view).toContain('usePeerBlocking({')
    expect(view).toContain('dropChat: (chatId: number) => {')
    expect(view).toContain('refreshChats: () => refreshChatsQuiet()')
    // Шапка чата берёт состояние из composable, а не считает его сама.
    expect(view).toContain(':blocked="peerFullyBlocked"')
    expect(view).toContain(':calls-blocked="peerCallsBlocked"')
  })
})

describe('список заблокированных', () => {
  const dialog = source('components/messenger/BlockedUsersDialog.vue')

  it('показывает вид блокировки и даёт переключить', () => {
    expect(dialog).toContain('· только звонки')
    expect(dialog).toContain('toggleKind')
    expect(dialog).toContain('messagesAllowed: !user.messages_allowed')
  })
})
