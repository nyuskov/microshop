import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Стражи «свой звук на чат».
 *
 * Настройка живёт в localStorage и применяется в момент прихода сообщения —
 * это цепочка из трёх файлов (меню чата → диалог → обработчик входящих).
 * Оборвать её легко и незаметно: пункт меню без обработчика или диалог, который
 * сохраняет выбор, но никто его не читает.
 */

const header = readFileSync('src/components/messenger/ChatHeader.vue', 'utf8')
const dialog = readFileSync('src/components/messenger/ChatSoundDialog.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

describe('пункт меню и диалог', () => {
  it('в меню чата есть пункт «Звук уведомлений»', () => {
    expect(header).toContain("runChatAction('sound')")
    expect(header).toContain('Звук уведомлений')
    expect(header).toContain("(e: 'open-chat-sound'): void")
    expect(header).toContain("if (action === 'sound') emit('open-chat-sound')")
  })

  it('диалог берёт список звуков из общего модуля и сохраняет выбор', () => {
    expect(dialog).toContain('MESSAGE_SOUNDS')
    expect(dialog).toContain('setChatSoundKey(props.chatId, key)')
    // Выбор прослушивается тем же звуком, что сыграет при сообщении.
    expect(dialog).toContain('playIncomingMessageSound(key ?? ')
    // Есть возврат к «как в остальных чатах» — иначе настройку не сбросить.
    expect(dialog).toContain('Как в остальных чатах')
  })
})

describe('применение звука чата', () => {
  it('входящее сообщение звучит звуком этого чата', () => {
    const handler = messenger.slice(messenger.indexOf('const handleIncomingMessage'))
    expect(handler).toContain("playIncomingMessageSound(chatSoundKey(chatId) ?? 'default')")
    // Мьют, открытый чат в фокусе и тихие часы по-прежнему глушат звук.
    const silence = messenger.slice(messenger.indexOf('const shouldSilenceMessageSound'))
    expect(silence).toContain('mutedChatIds.value.includes(chatId)')
    expect(silence).toContain('isQuietHoursNow(authStore.current_user?.profile)')
  })

  it('диалог подключён лениво и открывается из шапки чата', () => {
    expect(messenger).toContain("import('@/components/messenger/ChatSoundDialog.vue')")
    expect(messenger).toContain('const chatSoundOpen = ref(false)')
    expect(messenger).toContain('@open-chat-sound="chatSoundOpen = true"')
    expect(messenger).toContain('v-if="chatSoundOpen && selectedChat"')
  })
})
