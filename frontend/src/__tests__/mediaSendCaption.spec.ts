import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MediaSendDialog from '@/components/messenger/MediaSendDialog.vue'

/**
 * Окно отправки вложения: превью + подпись (как в Телеграме).
 *
 * Зачем фича: раньше подпись получалась только у того файла, который уходил
 * первым, и только если текст был набран ДО выбора файла — «прикрепил фото,
 * потом написал комментарий» было невозможно. Проверяем саму развилку: файлы
 * сначала попадают в окно, подпись пишется там, и только потом уходит отправка.
 */

const image = (name = 'photo.png'): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const document = (): File =>
  new File([new Uint8Array([1, 2, 3])], 'otchet.pdf', { type: 'application/pdf' })

beforeEach(() => {
  // В jsdom нет объектных ссылок: подменяем, иначе превью картинки падало бы.
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview'),
    writable: true,
    configurable: true
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    writable: true,
    configurable: true
  })
})

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(MediaSendDialog, {
    props: { files: [image()], ...props },
    global: { stubs: { 'q-icon': true } }
  })

describe('окно отправки вложения', () => {
  it('показывает превью картинки и поле подписи', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('.send-thumb').exists()).toBe(true)
    expect(wrapper.find('.send-caption').exists()).toBe(true)
    wrapper.unmount()
  })

  it('не картинка показывается карточкой с именем и размером', () => {
    const wrapper = mountDialog({ files: [document()] })
    expect(wrapper.find('.send-thumb').exists()).toBe(false)
    expect(wrapper.find('.send-file-name').text()).toBe('otchet.pdf')
    wrapper.unmount()
  })

  it('подпись из поля ввода приходит уже набранной', async () => {
    // Человек написал комментарий и только потом прикрепил фото: текст не
    // теряется, он ждёт в подписи.
    const wrapper = mountDialog({ caption: 'смотрите какой вид' })
    const field = wrapper.find<HTMLTextAreaElement>('.send-caption')
    expect(field.element.value).toBe('смотрите какой вид')
    wrapper.unmount()
  })

  it('«Отправить» отдаёт подпись без лишних пробелов', async () => {
    const wrapper = mountDialog({ caption: 'комментарий' })
    await wrapper.find('.send-caption').setValue('  комментарий к фото  ')
    await wrapper.find('.send-primary').trigger('click')

    expect(wrapper.emitted('send')?.[0]).toEqual(['комментарий к фото'])
    wrapper.unmount()
  })

  it('можно отправить без подписи', async () => {
    const wrapper = mountDialog()
    await wrapper.find('.send-primary').trigger('click')
    expect(wrapper.emitted('send')?.[0]).toEqual([''])
    wrapper.unmount()
  })

  it('«Отмена», Escape и клик мимо закрывают окно без отправки', async () => {
    for (const close of ['button', 'escape', 'backdrop'] as const) {
      const wrapper = mountDialog()
      if (close === 'button') await wrapper.find('.send-ghost').trigger('click')
      if (close === 'escape')
        await wrapper.find('.send-caption').trigger('keydown', { key: 'Escape' })
      if (close === 'backdrop') await wrapper.find('.media-send-overlay').trigger('mousedown')
      expect(wrapper.emitted('close')).toHaveLength(1)
      expect(wrapper.emitted('send')).toBeUndefined()
      wrapper.unmount()
    }
  })

  it('показывает цитату ответа и предупреждение об одноразовом медиа', () => {
    const wrapper = mountDialog({
      viewOnce: true,
      replyTo: { name: 'Мама', text: 'пришли фото' }
    })
    expect(wrapper.find('.send-reply-name').text()).toBe('Мама')
    expect(wrapper.find('.send-note').text()).toContain('сгорит')
    wrapper.unmount()
  })

  it('пачка подписана числом файлов (альбом уйдёт одним сообщением)', () => {
    const wrapper = mountDialog({ files: [image('a.png'), image('b.png'), image('c.png')] })
    expect(wrapper.find('.ms-overlay-title').text()).toBe('Отправить 3 файла')
    expect(wrapper.findAll('.send-thumb')).toHaveLength(3)
    expect(wrapper.find('.send-grid').classes()).toContain('cols-3')
    wrapper.unmount()
  })
})

describe('подпись к вложению: как оно встроено', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')

  it('файлы из любого источника сначала попадают в окно отправки', () => {
    const messenger = read('src/views/Messenger.vue')
    // Кнопка «Прикрепить», вставка из буфера и перетаскивание — одна дорога.
    expect(messenger).toContain('const onFilesSelected = (files: File[], viewOnce = false) => {')
    expect(messenger).toContain('openSendDialog(files, viewOnce)')
    expect(messenger).toContain('openSendDialog(files)')
    expect(messenger).toContain('void sendFiles(pending.files, pending.viewOnce, caption)')
    // Окно монтируется, когда есть что отправлять.
    expect(messenger).toContain('v-if="pendingSend"')
    expect(messenger).toContain(
      "const MediaSendDialog = defineAsyncComponent(\n  () => import('@/components/messenger/MediaSendDialog.vue')\n)"
    )
  })

  it('подпись уходит первым файлом пачки, остальным — ничего', () => {
    const messenger = read('src/views/Messenger.vue')
    expect(messenger).toContain('let captionLeft: string | null | undefined = caption')
    expect(messenger).toContain('const partCaption = index === 0 ? captionLeft : null')
  })

  it('гифка уходит с комментарием из поля ввода', () => {
    // Тап по гифке отправляет её сразу — «написать подпись после» невозможно,
    // поэтому берём текст, который человек уже набрал.
    const composer = read('src/components/messenger/MessageComposer.vue')
    const picker = read('src/components/media/GifPicker.vue')
    const service = read('src/services/chatService.ts')
    expect(composer).toContain(':caption="newMessage.trim()"')
    expect(picker).toContain('props.caption ?? ')
    expect(service).toContain('caption\n  }')
    // Поле очищается вместе с отправкой: текст уехал подписью, а не потерялся.
    const messenger = read('src/views/Messenger.vue')
    expect(messenger).toContain('if (newMessage.value.trim()) {')
  })
})
