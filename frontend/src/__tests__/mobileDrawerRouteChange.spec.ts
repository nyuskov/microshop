import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Drawer со списком чатов не должен закрываться сам.
 *
 * Quasar умеет скрывать `q-drawer` при ЛЮБОЙ смене `$route.fullPath`
 * (`use-model-toggle` → `hideOnRouteChange`, включается в мобильном режиме).
 * Приложение же ведёт навигацию на мобильном само (`utils/mobileNav.ts`) и
 * делает это настоящими шагами истории: после `history.go(-1)` vue-router
 * «догоняет» адрес и видит смену маршрута. Из-за этого список закрывался в
 * момент закрытия настроек, лайтбокса или карточки чата — человек оставался на
 * переписке вместо списка. Лечится `persistent` на мобильном.
 *
 * Проверка статическая: jsdom не считает ни раскладку, ни поведение Quasar,
 * поэтому читаем исходник и следим за самим условием.
 */
const messengerSource = readFileSync('src/views/Messenger.vue', 'utf8')

describe('Drawer и смена маршрута', () => {
  it('на мобильном drawer объявлен persistent', () => {
    expect(messengerSource).toMatch(/:persistent="!isDesktop"/)
  })

  it('свайп и закрытие по фону остаются управляемыми приложением', () => {
    // `persistent` гасит только скрытие по маршруту и по Escape — эти два
    // атрибута продолжают работать и должны остаться на месте.
    expect(messengerSource).toMatch(/:no-swipe-open="!isDesktop && selectedChatId !== null"/)
    expect(messengerSource).toMatch(/:no-swipe-close="!isDesktop && selectedChatId === null"/)
  })
})
