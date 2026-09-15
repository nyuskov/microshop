import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Drawer со списком чатов не должен закрываться сам.
 *
 * Quasar умеет скрывать `q-drawer` при ЛЮБОЙ смене `$route.fullPath`
 * (`use-model-toggle` → `hideOnRouteChange`, включается в мобильном режиме).
 * Приложение же ведёт навигацию на телефоне само (`utils/mobileNav.ts`) и
 * делает это настоящими шагами истории: после `history.go(-1)` vue-router
 * «догоняет» адрес и видит смену маршрута. Из-за этого список закрывался в
 * момент закрытия настроек, лайтбокса или карточки чата — человек оставался на
 * переписке вместо списка. Лечится `persistent` на телефоне.
 *
 * Проверка статическая: jsdom не считает ни раскладку, ни поведение Quasar,
 * поэтому читаем исходник и следим за самим условием.
 */
const messengerSource = readFileSync('src/views/Messenger.vue', 'utf8')

describe('Drawer и смена маршрута', () => {
  it('на телефоне drawer объявлен persistent', () => {
    expect(messengerSource).toMatch(/:persistent="isPhone"/)
  })

  it('свайп и закрытие по фону остаются управляемыми приложением', () => {
    // `persistent` гасит только скрытие по маршруту и по Escape — эти два
    // атрибута продолжают работать и должны остаться на месте.
    expect(messengerSource).toMatch(/:no-swipe-open="isPhone && selectedChatId !== null"/)
    expect(messengerSource).toMatch(/:no-swipe-close="isPhone && selectedChatId === null"/)
  })
})

/**
 * Планшет (600–1023px): список и нить видны одновременно.
 *
 * Раньше порог был 1023px, то есть на планшете включался «телефонный» режим:
 * список открывался полноэкранным оверлеем поверх чата, а системная «назад»
 * вела по истории приложения. Теперь на планшете две панели, а «телефонное»
 * поведение осталось только ниже 600px (`$q.screen.lt.sm`).
 */
describe('Планшет: две панели с 600px', () => {
  it('порог Quasar-drawer — 599px, а не 1023px', () => {
    expect(messengerSource).toMatch(/:breakpoint="599"/)
    expect(messengerSource).not.toMatch(/:breakpoint="1023"/)
  })

  it('оверлей и «телефонная» навигация включены только на телефоне', () => {
    expect(messengerSource).toMatch(/:overlay="isPhone"/)
    expect(messengerSource).toMatch(/const isPhone = computed\(\(\) => \$q\.screen\.lt\.sm\)/)
    expect(messengerSource).toMatch(/const twoPane = computed\(\(\) => !isPhone\.value\)/)
  })

  it('«назад» в шапке чата — только на телефоне', () => {
    expect(messengerSource).toMatch(/:show-back="isPhone"/)
  })

  it('планшет не тратит половину экрана на список', () => {
    // 380px на 600–1023px съедала бы больше половины ширины.
    expect(messengerSource).toMatch(/return 320/)
  })
})
