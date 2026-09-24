import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Свёрнутый звонок: «скрыть звонок и остаться в чате» (как в MAX).
 *
 * Плашка ложится поверх шапки чата, а полный экран звонка убирается с глаз.
 * Главное, что здесь защищаем:
 *   1) оверлей НЕ размонтируется — иначе пропадёт звук (поток Chrome отдаёт в
 *      Web Audio только привязанным к элементу, проверено живьём 18.09.2026);
 *   2) входящий звонок свернуть нельзя — его надо принять или отклонить;
 *   3) плашка живёт в панели чата (перекрывает шапку) и, на телефоне, над
 *      списком чатов: иначе в списке звонок был бы недостижим.
 */
const source = (path: string): string => readFileSync(path, 'utf8')
const store = source('src/stores/call.ts')
const overlay = source('src/components/calls/CallOverlay.vue')
const banner = source('src/components/calls/CallBanner.vue')
const messenger = source('src/views/Messenger.vue')

describe('стор: состояние «свёрнут»', () => {
  it('живёт в состоянии и сбрасывается вместе с остальным звонком', () => {
    expect(store).toMatch(/minimized: boolean/)
    expect(store).toMatch(/minimized: false,/)
  })

  it('свернуть можно разговор и свой вызов, но не входящий', () => {
    // Спрятанная кнопка «Ответить» была бы поломкой: входящий надо принять
    // или отклонить.
    const action = store.slice(store.indexOf('minimizeCall() {'), store.indexOf('restoreCall() {'))
    expect(action).toMatch(/if \(this\.status !== 'active' && this\.status !== 'outgoing'\) return/)
    expect(action).toContain('this.minimized = true')
    expect(store).toContain('this.minimized = false')
  })
})

describe('полный экран звонка при сворачивании', () => {
  it('прячется классом, а не `v-if` — потоки остаются привязанными', () => {
    // Поток собеседника привязан к <video>: удали элемент — и Chrome перестанет
    // отдавать звук в Web Audio (так же звук «пропадал» 18.09.2026).
    expect(overlay).toContain("'call-overlay-hidden': callStore.minimized")
    expect(overlay).toMatch(/v-if="callStore\.status !== 'idle'"/)
    expect(overlay).toMatch(/\.call-overlay\.call-overlay-hidden \{[\s\S]{0,80}opacity: 0/)
    // Невидимые кнопки не должны ловить фокус и клики.
    expect(overlay).toContain(':inert="callStore.minimized || undefined"')
  })

  it('«Свернуть» есть и в разговоре, и в групповом вызове', () => {
    // В групповом ВЫЗОВЕ кнопка стоит в верхней строке рядом с «Отменить»:
    // угловая легла бы на неё.
    expect(overlay).toContain('@click="callStore.minimizeCall()"')
    expect(overlay).toContain('class="ringing-actions"')
    const collapse = overlay.slice(
      overlay.indexOf('const canMinimizeHere'),
      overlay.indexOf('const remoteVideoTracks')
    )
    expect(collapse).toMatch(
      /callStore\.status === 'active' \|\| \(callStore\.status === 'outgoing' && !callStore\.isGroup\)/
    )
    // Входящий вызов в условие не попадает.
    expect(collapse).not.toContain("status === 'incoming'")
  })

  it('открытые панели закрываются: в плашке их места нет', () => {
    const watcher = overlay.slice(overlay.indexOf('() => callStore.minimized'))
    expect(watcher).toContain('closePanels()')
    expect(watcher).toContain('effectsOpen.value = false')
  })
})

/**
 * Протяжка вверх по экрану звонка — второе (и привычное) «свернуть».
 *
 * Владелец, 24.09.2026: «сокрытие звонка не только по галке, а ещё и по просто
 * протяжке вверх». Жест делает РОВНО то же, что кнопка «Свернуть»: тот же
 * `minimizeCall()` в сторе, поэтому поток остаётся привязанным к элементу и звук
 * не пропадает (см. `call-overlay-hidden`).
 */
describe('протяжка вверх сворачивает звонок', () => {
  it('жест слушается на всём экране звонка и сворачивает по порогу', () => {
    expect(overlay).toContain('@pointermove="onOverlayPointerMove"')
    expect(overlay).toContain('@pointerup="onOverlayPointerUp"')
    expect(overlay).toContain('@pointercancel="onOverlayPointerUp"')
    const up = overlay.slice(
      overlay.indexOf('const onOverlayPointerUp'),
      overlay.indexOf('const resetDragOffset')
    )
    expect(up).toMatch(/pulled < SWIPE_UP_HIDE_PX/)
    expect(up).toContain('callStore.minimizeCall()')
  })

  it('тянем только вверх и только пальцем — не мешаем кнопкам и маске', () => {
    const move = overlay.slice(overlay.indexOf('const onOverlayPointerMove'))
    // Вниз и вбок — не наш жест: экран остаётся на месте.
    expect(move).toMatch(/dy >= 0 \|\| Math\.abs\(dx\) > Math\.abs\(dy\)/)
    const down = overlay.slice(overlay.indexOf('const onOverlayPointerDown'))
    expect(down).toContain("event.pointerType !== 'mouse'")
    // Кнопки, меню и превью с маской — со своими жестами и действиями.
    expect(down).toContain('!dragBlockedTarget(event.target)')
    expect(overlay).toContain(
      'target.closest(\'button, a, input, select, textarea, video, .call-popovers, [role="menu"]\')'
    )
  })

  it('входящий так не свернуть — его надо принять или отклонить', () => {
    const allowed = overlay.slice(
      overlay.indexOf('const canSwipeMinimize'),
      overlay.indexOf('const dragBlockedTarget')
    )
    expect(allowed).toMatch(/callStore\.status === 'active' \|\| callStore\.status === 'outgoing'/)
    expect(allowed).not.toContain("status === 'incoming'")
  })

  it('слой едет за пальцем и гаснет, а вертикальную прокрутку забираем себе', () => {
    // Иначе браузер понял бы жест как прокрутку/pull-to-refresh и перезагрузил бы
    // страницу прямо во время разговора.
    expect(overlay).toMatch(/\.call-overlay \{[\s\S]{0,900}touch-action: none/)
    expect(overlay).toMatch(/transform: translateY\(var\(--call-drag, 0px\)\)/)
    expect(overlay).toMatch(/--call-drag-fade/)
    // В момент жеста переходов нет: слой обязан следовать РОВНО за пальцем.
    expect(overlay).toMatch(/\.call-overlay\.call-dragging \{[\s\S]{0,40}transition: none/)
    expect(overlay).toContain("'call-dragging': dragging || noDragTransition")
  })
})

describe('плашка свёрнутого звонка', () => {
  it('возвращает в звонок и даёт главные действия', () => {
    expect(banner).toContain('callStore.restoreCall()')
    expect(banner).toContain('callStore.toggleMic()')
    // Кнопка сброса одна, но у вызова это «Отменить» (гасит вызов у всех).
    expect(banner).toContain('cancelCall()')
    expect(banner).toContain('endCall()')
    expect(banner).toContain("callStore.status === 'outgoing'")
    // Отдельной стрелки «развернуть» нет: тап по самой плашке и так
    // разворачивает звонок (владелец, 24.09.2026).
    expect(banner).not.toContain("'expand_less'")
  })

  it('в группе показывает «Групповой звонок», а не список участников', () => {
    expect(banner).toContain("if (callStore.isGroup) return t('Групповой звонок')")
  })

  it('по шапке бежит волна — видно, что разговор идёт', () => {
    // Владелец: «а то непонятно, только галка» — статичная плашка с одной
    // стрелкой не говорила, что звонок ещё жив.
    expect(banner).toContain('class="cb-wave"')
    expect(banner).toContain('cb-wave-run')
    // Волна — ОДИН непрерывный путь (4 периода), а сдвиг — на половину ширины
    // (целое число периодов): шва между копиями нет, а при «уменьшить движение»
    // (a11y.css гасит анимации) кадр остаётся целой волной.
    expect(banner).toContain('viewBox="0 0 480 14"')
    expect(banner).not.toContain('v-for="copy in 2"')
    expect(banner).toMatch(/@keyframes cb-wave-run \{[\s\S]{0,120}translateX\(-50%\)/)
  })

  it('высота совпадает с шапкой чата — плашка её перекрывает целиком', () => {
    // Замеры вживую 24.09.2026: телефон — шапка 58px (аватар 40 + отступы 8+8
    // + линия 1), широкий экран — 61px (подписи шапки крупнее), 380px и уже —
    // 49px (аватар 36 и отступы 6+6).
    expect(banner).toMatch(/min-height: 58px/)
    expect(banner).toMatch(/@media \(min-width: 600px\) \{[\s\S]{0,80}min-height: 63px/)
    expect(banner).toMatch(/@media \(max-width: 380px\) \{[\s\S]{0,200}min-height: 49px/)
  })
})

describe('плашка в каркасе мессенджера', () => {
  it('в панели чата лежит поверх шапки', () => {
    const rule = messenger.slice(messenger.indexOf('.call-banner-overlay {'))
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('z-index: 5')
    expect(messenger).toContain('class="call-banner-overlay"')
    // Панель чата — точка отсчёта для плашки.
    const panel = messenger.slice(messenger.indexOf('.chat-panel {'))
    expect(panel).toContain('position: relative')
  })

  it('на телефоне есть над списком чатов — иначе звонок недостижим', () => {
    expect(messenger).toContain('v-if="isPhone && callStore.minimized"')
    expect(messenger).toContain('class="call-banner-drawer"')
    // Кнопка «назад»: плашка закрывает шапку, а из чата надо уметь выйти.
    expect(messenger).toContain(':show-back="isPhone"')
    expect(messenger).toContain('@back="goBackToList"')
  })
})
