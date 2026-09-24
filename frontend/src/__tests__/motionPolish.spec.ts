import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { flyEmoji, prefersReducedMotion } from '@/composables/useFlyingEmoji'

/**
 * Движение в интерфейсе: отклик на протяжку вниз, полёт реакции и микродвижения.
 *
 * Проверяем две вещи. Первая — сам помощник полёта: он обязан молча ничего не
 * делать там, где анимации нет (jsdom, старый движок) и где человек просил
 * «уменьшить движение» (a11y): иначе элемент остался бы висеть на экране.
 * Вторая — контракт по исходникам: в жесте протяжки остались шаги и пороги, а
 * отклик (полоса, вибрация) к ним приклеен.
 */
const source = (path: string): string => readFileSync(path, 'utf8')
const sidebar = source('src/components/messenger/ChatSidebar.vue')
const header = source('src/components/messenger/ChatHeader.vue')
const list = source('src/components/messenger/ChatList.vue')
const composer = source('src/components/messenger/MessageComposer.vue')
const row = source('src/components/messenger/MessageRow.vue')
const results = source('src/components/messenger/SearchResults.vue')
const actions = source('src/components/messenger/MessageActionsBar.vue')
const banner = source('src/components/calls/CallBanner.vue')
const overlay = source('src/components/calls/CallOverlay.vue')
const store = source('src/stores/call.ts')

/** Тело функции по её началу (до следующей `const`/`function` того же уровня). */
const fnBody = (text: string, start: string): string => {
  const from = text.indexOf(start)
  expect(from, `не найдено: ${start}`).toBeGreaterThan(-1)
  const rest = text.slice(from + start.length)
  const end = rest.search(/\n(?:const |function |let )/)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('полёт реакции', () => {
  it('пролетает от кнопки к чипам сообщения', () => {
    expect(actions).toContain("from '@/composables/useFlyingEmoji'")
    // Куда лететь: чипы ЭТОГО сообщения (строка ищется по data-message-id).
    expect(actions).toContain('data-message-id=')
    expect(actions).toContain("row.querySelector<HTMLElement>('.reactions')")
    // Откуда: кнопка, по которой нажали (в палитре — сама панель).
    expect(actions).toContain('onQuickReaction(emoji, $event)')
    expect(actions).toContain('event.currentTarget')
    expect(actions).toContain('flyEmoji(')
  })

  it('не оставляет элемент на экране, если анимации нет', () => {
    // jsdom (там нет `Element.animate`) — самый частый случай: помощник обязан
    // просто промолчать, а не бросать исключение.
    expect(typeof document.createElement('span').animate).not.toBe('function')
    expect(() => flyEmoji('👍', { x: 10, y: 10 }, { x: 60, y: 90 })).not.toThrow()
    expect(document.querySelectorAll('body > span').length).toBe(0)
  })

  it('уважает «уменьшить движение»', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia

    expect(prefersReducedMotion()).toBe(true)
    expect(() => flyEmoji('🔥', { x: 1, y: 1 }, { x: 2, y: 2 })).not.toThrow()
    expect(document.querySelectorAll('body > span').length).toBe(0)

    window.matchMedia = original
  })

  it('снятая реакция «сдувается», а нажатие отзывается сжатием', () => {
    expect(row).toMatch(/\.reaction-leave-to \{[\s\S]{0,120}scale\(0\.5\)/)
    expect(row).toContain('.reaction-chip:active')
  })
})

describe('отклик на протяжку вниз', () => {
  it('панель едет за пальцем по резинке', () => {
    // Смещение панели живёт на переменной: его пишет жест, читает CSS.
    expect(sidebar).toContain("'--ms-pull-y'")
    expect(sidebar).toMatch(/\.side-panel \{[\s\S]{0,600}translateY\(var\(--ms-pull-y/)
    // Во время движения переход выключен, иначе панель отставала бы от пальца.
    expect(sidebar).toContain('.side-panel.pulling {')
    // Ход асимптотический: линейный с жёстким пределом читался как сильная
    // натяжка («панель упёрлась в стену»).
    expect(sidebar).toMatch(/PULL_SOFT_PX = \d+/)
    expect(sidebar).toContain('1 - Math.exp(-distance / PULL_SOFT_PX)')
    expect(sidebar).not.toContain('PULL_DAMPING')
    // Максимум хода меньше порога раскрытия поиска — «упора» не видно.
    const max = Number(sidebar.match(/PULL_MAX_PX = (\d+)/)?.[1] ?? '0')
    const search = Number(sidebar.match(/PULL_EXPAND_PX = (\d+)/)?.[1] ?? '0')
    expect(max).toBeGreaterThan(0)
    expect(max).toBeLessThan(search)
  })

  it('полосы прогресса сверху нет', () => {
    // Владелец: «сверху всегда синяя полоса появляется» — выглядело чужой
    // цветной чертой над шапкой, поэтому отклик живёт только в самом движении.
    expect(sidebar).not.toContain('pull-bar')
    expect(sidebar).not.toContain('--ms-pull-progress')
  })

  it('раскрытие продолжается с высоты протяжки — без прыжка', () => {
    // Панель появляется ровно той высоты, на которую её вытянул палец, а
    // смещение панели снимается тем же кадром — сумма не меняется скачком.
    expect(sidebar).toMatch(/startFrom: \(\) => pullHandoff\.value/)
    expect(sidebar).toContain('const handOffPull = () => {')
    const body = fnBody(sidebar, 'const onPanelTouchMove = ')
    expect(body).toContain('handOffPull()')
  })

  it('на порогах отзывается вибрация, а шаги и порядок не изменились', () => {
    const body = fnBody(sidebar, 'const onPanelTouchMove = ')
    expect(body).toContain('haptic()')
    expect(body).toContain('revealSearch()')
    expect(body).toContain('setStoriesExpanded(true)')
    expect(body).toContain('openStoriesPlayback()')
    expect(body).toContain('if (!pullFromList || listIsScrolled(list)) return')
    // Панель возвращается на место при отпускании и в начале касания.
    expect(sidebar).toContain('const resetPull = () => {')
    expect(sidebar).toContain('@touchend.passive="onPanelTouchEnd"')
    expect(sidebar).toContain('@touchcancel.passive="onPanelTouchEnd"')
  })

  it('жёст по шапке по-прежнему панели не открывает', () => {
    expect(sidebar).toContain("target.closest('.chat-scroll')")
    const body = fnBody(sidebar, 'const onPanelTouchMove = ')
    // Смещение панели считается ТОЛЬКО после проверки, что тянем по списку:
    // иначе шапка уезжала бы вместе с пальцем.
    expect(body.indexOf('pullFromList')).toBeLessThan(body.indexOf('pulling.value = true'))
  })
})

describe('микродвижения', () => {
  it('смена чата: название и подпись въезжают, ключ — по id чата', () => {
    expect(header).toContain(':key="props.chat.id"')
    expect(header).toContain('@keyframes chat-swap {')
    // Постоянные обновления (статус, «печатает») не пересоздают элемент: ключ от
    // них не зависит.
    expect(header).not.toContain(':key="subtitle"')
    expect(header).not.toContain(':key="statusPill"')
  })

  it('счётчик непрочитанных отзывается на новое число', () => {
    expect(list).toContain(':key="chat.unread_count"')
    expect(list).toContain('@keyframes unread-bounce {')
  })

  it('кнопка отправки «выпрыгивает» и отзывается нажатием', () => {
    expect(composer).toContain('@keyframes send-pop {')
    expect(composer).toContain('.send-btn:active {')
  })

  it('результаты поиска входят друг за другом', () => {
    expect(results).toContain('animation: row-in 0.18s var(--ms-ease) both')
    expect(results).toContain('.row-item:nth-child(n + 8)')
    // Задержка ограничена: длинный список не должен «дописываться» дольше, чем
    // длится сам поиск.
    expect(results).toContain('animation-delay: 112ms')
  })
})

describe('собеседник говорит', () => {
  it('уровень речи считается и для 1:1, а не только для группы', () => {
    expect(store).toContain('peerSpeaking: boolean')
    expect(store).toContain('peerSpeaking: false')
    const body = fnBody(store, '_updateSpeaking() {')
    // Раньше стоял ранний выход для 1:1 (`participants.length < 2`) — из-за него
    // в личном звонке признак речи не обновлялся вообще.
    expect(body).not.toContain('participants.length < 2')
    expect(body).toContain('this.peerSpeaking = speakingNow(')
  })

  it('аватар отвечает кольцом и в плашке, и в звонке', () => {
    expect(banner).toContain(':class="{ speaking: peerSpeaking }"')
    expect(banner).toContain('callStore.peerSpeaking')
    expect(banner).toContain('@keyframes cb-speaking {')
    expect(overlay).toContain(':class="{ speaking: peerSpeaking }"')
    expect(overlay).toContain('@keyframes avatar-speaking {')
  })
})
