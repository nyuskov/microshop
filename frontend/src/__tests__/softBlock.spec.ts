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
    expect(header).toContain("callsBlocked ? 'Принимать звонки' : 'Не принимать звонки'")
    expect(header).toContain("(e: 'toggle-calls-block'): void")
  })

  it('при полной блокировке пункт про звонки скрыт, а блокировка становится разблокировкой', () => {
    expect(header).toContain('v-if="!blocked"')
    expect(header).toContain("blocked ? 'Разблокировать' : 'Заблокировать'")
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

describe('Messenger', () => {
  const view = source('views/Messenger.vue')

  it('знает состояние блокировки открытого чата, а не только факт нажатия', () => {
    expect(view).toContain('const peerBlockState = ref<BlockState>')
    expect(view).toContain('const peerFullyBlocked = computed(')
    expect(view).toContain('const peerCallsBlocked = computed(')
    expect(view).toContain('await fetchBlockState(peer.id)')
  })

  it('мягкая блокировка не закрывает чат: переписка остаётся', () => {
    // В toggleSelectedPeerCalls нет выкидывания чата из списка и очистки ленты —
    // это делает только полная блокировка (blockPeer).
    const start = view.indexOf('const toggleSelectedPeerCalls')
    const body = view.slice(start, start + 1400)
    expect(body).not.toContain('chats.value = chats.value.filter')
    expect(body).not.toContain('messages.value = []')
  })

  it('повторное нажатие «Заблокировать» при полной блокировке снимает её', () => {
    expect(view).toContain('if (peerFullyBlocked.value) {')
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
