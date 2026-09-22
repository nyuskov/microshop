import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BrandSpinner from '@/components/common/BrandSpinner.vue'

/**
 * Кружок ожидания: без подписей, в стиле приложения и заметно крупнее.
 *
 * Просьба владельца: «все надписи рядом с кружком типа “Открываю чат” надо
 * убрать, а кружок сделать в нашем стиле и побольше». Проверяем и сам кружок, и
 * то, что подписи не вернулись: они были в трёх состояниях — восстановление чата,
 * окно звонка из уведомления и ожидание расшифровки кадра.
 */

describe('кружок ожидания', () => {
  it('это кружок с ролью status и невидимой подписью для диктора', () => {
    const wrapper = mount(BrandSpinner, { props: { label: 'Открываю чат' } })
    const spinner = wrapper.find('.brand-spinner')

    expect(spinner.exists()).toBe(true)
    expect(spinner.attributes('role')).toBe('status')
    // Текст только для экранного диктора: на экране подписи нет.
    expect(spinner.attributes('aria-label')).toBe('Открываю чат')
    expect(wrapper.text()).toBe('')
    wrapper.unmount()
  })

  it('размер задаётся состоянием, а толщина кольца растёт вместе с ним', () => {
    const small = mount(BrandSpinner, { props: { size: 56 } }).find('.brand-spinner')
    const large = mount(BrandSpinner, { props: { size: 104 } }).find('.brand-spinner')

    expect(small.attributes('style')).toContain('width: 56px')
    expect(small.attributes('style')).toContain('border-width: 4px')
    expect(large.attributes('style')).toContain('width: 104px')
    expect(large.attributes('style')).toContain('border-width: 7px')
  })

  it('по умолчанию круглый и нарисован токенами', () => {
    const source = readFileSync('src/components/common/BrandSpinner.vue', 'utf8')
    expect(source).toContain('border-radius: var(--ms-radius-pill)')
    expect(source).toContain('border-top-color: var(--ms-accent)')
    expect(source).toContain('var(--brand-spinner-track, var(--ms-accent-soft))')
    // Размер — это видимый диаметр: рамка не должна прибавляться к нему.
    expect(source).toContain('box-sizing: border-box')
    // Бесконечная анимация — при «уменьшить движение» она замедляется, а не пропадает.
    expect(source).toContain('prefers-reduced-motion: reduce')
  })
})

describe('подписи рядом с кружком убраны, кружок крупнее', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')

  it('восстановление чата: только кружок', () => {
    const messenger = read('src/views/Messenger.vue')
    const block = messenger.slice(messenger.indexOf('class="chat-restoring"'))
    expect(block.slice(0, 200)).toContain(
      '<BrandSpinner :size="56" :label="t(\'Открываю чат\')" />'
    )
    // Подпись и прежний мелкий спиннер не вернулись.
    expect(messenger).not.toContain('>Открываю чат…<')
    expect(messenger).not.toContain('<q-spinner size="30px" color="primary" />')
  })

  it('окно звонка из уведомления: крупный кружок вместо подписи', () => {
    const messenger = read('src/views/Messenger.vue')
    // Разметка именно ожидающего звонка: у экрана «Вызов завершён» подпись
    // остаётся (это результат, а не ожидание).
    const block = messenger.slice(
      messenger.indexOf('class="call-launch-wait"'),
      messenger.indexOf("callLaunchScreen === 'missed'")
    )
    expect(block).toContain(':label="t(\'Входящий звонок\')"')
    // «Входящий звонок…»/«Отвечаем…» больше нет: ожидание показывает сам кружок,
    // а принятое нажатие — кружок внутри кнопки «Ответить».
    expect(block).not.toContain('Входящий звонок…')
    expect(block).not.toContain('Отвечаем…')
    expect(block).not.toContain('clw-text')
    expect(block).toContain(
      '<BrandSpinner v-if="callLaunchAnswering" :size="26" :label="t(\'Отвечаем\')" />'
    )
    // Палитра звонка: на тёмном фоне акцентная подложка не видна.
    expect(messenger).toContain('--brand-spinner-track: var(--ms-call-ring)')
    expect(messenger).not.toContain('@keyframes clw-spin')
    expect(messenger).not.toContain('.clw-ring')
  })

  it('ожидание расшифровки кадра: кружок вместо строки текста', () => {
    const lightbox = read('src/components/media/ImageLightbox.vue')
    expect(lightbox).toContain('<BrandSpinner :size="48" :label="t(\'Открываем изображение\')" />')
    expect(lightbox).not.toContain('Открываем изображение…')
    expect(lightbox).not.toContain('lb-loading-text')
    expect(lightbox).toContain('--brand-spinner-track: var(--ms-scrim-soft)')
  })
})
