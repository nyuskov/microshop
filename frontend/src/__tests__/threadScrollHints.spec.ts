/**
 * Стражи прокрутки ленты: кнопка «вверх» и приход нового сообщения.
 *
 * Проверки читают исходники: сценарий «прокрутил на два экрана и пришло новое
 * сообщение» в юнит-тесте поднимать нечем (высоты, скролл-контейнер, таймер), а
 * сломать легко — достаточно убрать порог или подменить «по смене хвоста» на
 * «при отрисовке» (тогда движение получала бы вся история при каждом открытии).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

const thread = source('src/components/messenger/MessageThread.vue')
const row = source('src/components/messenger/MessageRow.vue')
const en = source('src/i18n/en.ts')

describe('кнопка «вверх» в ленте', () => {
  it('появляется только когда до начала ленты далеко', () => {
    expect(thread).toContain('const JUMP_UP_MIN_SCROLL')
    expect(thread).toContain('showJumpUp.value = container.scrollTop > JUMP_UP_MIN_SCROLL')
    expect(thread).toContain('v-if="showJumpUp"')
  })

  it('видны обе кнопки — «вверх» уезжает выше «вниз»', () => {
    expect(thread).toContain(':class="{ stacked: showJumpDown }"')
    expect(thread).toMatch(/\.jump-up\.stacked\s*\{\s*bottom:\s*56px;/)
  })

  it('к началу ленты ведёт плавно, но уважает «меньше движения»', () => {
    expect(thread).toContain('const scrollBehavior = (): ScrollBehavior')
    expect(thread).toContain('prefers-reduced-motion: reduce')
    expect(thread).toContain('container.scrollTo({ top: 0, behavior: scrollBehavior() })')
  })

  it('подписи переведены', () => {
    expect(en).toContain("Вверх: 'Up'")
    expect(en).toContain("'Прокрутить вверх': 'Scroll up'")
  })
})

describe('приход нового сообщения', () => {
  it('движение ставится по смене хвоста ленты, а не по отрисовке', () => {
    // Смена хвоста — единственный признак «пришло новое»: смена чата и догрузка
    // старых страниц хвост не меняют, значит движения не получают.
    expect(thread).toContain('markEntering(id)')
    expect(thread).toContain(':entering="enterId === item.row.message.id"')
    expect(thread).toContain('ENTER_ANIMATION_MS')
    // Таймер обязан сниматься при размонтировании (иначе запись в размонтированный
    // компонент после ухода из чата).
    expect(thread).toContain('if (enterTimer !== undefined) globalThis.clearTimeout(enterTimer)')
  })

  it('строка въезжает снизу и проявляется', () => {
    expect(row).toContain("'msg-enter': entering")
    expect(row).toMatch(/\.msg\.msg-enter\s*\{\s*animation:\s*msg-enter/)
    expect(row).toContain('@keyframes msg-enter')
  })
})
