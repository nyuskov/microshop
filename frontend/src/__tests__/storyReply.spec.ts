import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Стражи «ответа на историю текстом».
 *
 * Путь длинный и живёт в разметке: поле в просмотрщике → событие `reply` →
 * отправка в личный чат автора с `reply_to_story_id` → плашка в ленте. Сломать
 * его можно молча (поле есть, а снимок истории не передаётся), поэтому читаем
 * исходники и проверяем связки между звеньями.
 */

const viewer = readFileSync('src/components/stories/StoryViewer.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
const service = readFileSync('src/services/chatService.ts', 'utf8')
const storiesStore = readFileSync('src/stores/stories.ts', 'utf8')

describe('поле ответа в просмотрщике историй', () => {
  it('есть только на чужой истории и шлёт событие наверх', () => {
    expect(viewer).toContain('v-if="!current.isMine"')
    expect(viewer).toContain('class="viewer-reply"')
    expect(viewer).toContain('@submit.prevent="sendReply"')
    expect(viewer).toContain("(e: 'reply', payload:")
    expect(viewer).toContain(
      "emit('reply', { storyId: entry.story.id, authorId: entry.author.id, text })"
    )
  })

  it('пустой текст не отправляется, а поле чистится после отправки', () => {
    const send = viewer.slice(viewer.indexOf('const sendReply'))
    expect(send).toContain('replyText.value.trim()')
    expect(send).toContain('if (!entry || entry.isMine || !text) return')
    expect(send).toContain("replyText.value = ''")
  })

  it('недописанный ответ не переезжает на следующую историю', () => {
    const watcher = viewer.slice(viewer.indexOf('watch(currentId'))
    expect(watcher).toContain("replyText.value = ''")
  })

  it('жесты показа не мешают набору текста', () => {
    // Поле гасит всплытие: набор и тапы по кнопке не листают истории.
    expect(viewer).toContain('@pointerdown.stop')
    expect(viewer).toContain('@keydown.stop')
  })
})

describe('отправка ответа в личный чат автора', () => {
  it('просмотрщик связан с обработчиком', () => {
    expect(messenger).toContain('@reply="replyToStory"')
  })

  it('ответ уходит в личный чат со снимком истории', () => {
    const handler = messenger.slice(messenger.indexOf('const replyToStory'))
    expect(handler).toContain('openPrivateChat(payload.authorId)')
    expect(handler).toContain(
      'sendNewMessage(chat.id, wireText, null, wireEncrypted, payload.storyId)'
    )
    // Просмотрщик остаётся открытым: истории листаются дальше.
    expect(handler).not.toContain('openStoryId.value = null')
  })

  it('шифрование как у обычной отправки', () => {
    const handler = messenger.slice(messenger.indexOf('const replyToStory'))
    expect(handler).toContain('chatKeyOf(chat)')
    expect(handler).toContain('encryptText(aes, payload.text)')
  })

  it('снимок истории уезжает на сервер параметром', () => {
    expect(service).toContain('replyToStoryId?: number | null')
    expect(service).toContain('reply_to_story_id: replyToStoryId ?? null')
  })
})

describe('плашка «Ответ на историю» в ленте', () => {
  it('рисуется из снимка сообщения', () => {
    expect(row).toContain('v-if="storyReply"')
    expect(row).toContain('class="story-reply"')
    expect(row).toContain('reply_to_story')
  })

  it('миниатюра берётся из снимка, видео помечается значком', () => {
    const computed = row.slice(row.indexOf('const storyReplyThumb'))
    expect(computed).toContain('storyReply.value?.media_url')
    expect(row).toContain('storyReplyIsVideo')
  })
})

describe('холодный старт по уведомлению', () => {
  it('загрузку ленты ждут все, кто её запросил', () => {
    // Иначе холодный старт проверял ещё пустую ленту и не открывал историю.
    expect(storiesStore).toContain('if (feedLoad) return feedLoad')
    expect(storiesStore).toContain('feedLoad = null')
  })

  it('история из адреса открывается, даже если лента устарела', () => {
    const handler = messenger.slice(messenger.indexOf('const openStoryFromPush'))
    expect(handler).toContain('await storiesStore.load()')
    expect(handler).toContain('if (known()) openStory(storyId)')
  })
})
