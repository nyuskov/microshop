/**
 * Стражи «связь с сервером видна в шапке».
 *
 * Раньше про обрыв связи сообщала полоса во всю ширину сверху. В мессенджере её
 * убрали (она перекрывала содержимое), а состояние переехало в шапки:
 *  - список чатов — пилюля в свободном месте шапки (`ConnectionStatus`);
 *  - открытый чат — подпись вместо присутствия собеседника (на телефоне в этот
 *    момент шапка списка скрыта в drawer, значит, иначе про обрыв в чате не
 *    сообщало бы ничего);
 *  - вне мессенджера (вход, приглашение) — прежняя полоса: шапок там нет.
 *
 * Проверки читают исходники: сценарий «пропала связь» в юнит-тесте не поднять
 * (маяк, интервалы, догрузка), а сломать легко — достаточно вернуть полосу или
 * забыть её спрятать.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

const status = source('src/components/common/ConnectionStatus.vue')
const notice = source('src/composables/useConnectionNotice.ts')
const sidebarHeader = source('src/components/messenger/SidebarHeader.vue')
const chatHeader = source('src/components/messenger/ChatHeader.vue')
const app = source('src/App.vue')
const banner = source('src/components/common/OfflineBanner.vue')
const onlineStatus = source('src/composables/useOnlineStatus.ts')
const en = source('src/i18n/en.ts')

describe('пилюля связи в шапке списка чатов', () => {
  it('стоит в свободном месте шапки — между историями и кнопками', () => {
    expect(sidebarHeader).toContain('<ConnectionStatus />')
    expect(sidebarHeader).toContain('.panel-header-status')
    // Пилюля — между историями и правой группой иконок, иначе место не то.
    const stories = sidebarHeader.indexOf('<StoriesStrip')
    const chip = sidebarHeader.indexOf('<ConnectionStatus />')
    const actions = sidebarHeader.indexOf('class="panel-header-right"')
    expect(stories).toBeGreaterThan(-1)
    expect(chip).toBeGreaterThan(stories)
    expect(actions).toBeGreaterThan(chip)
    // Ровно по центру свободного промежутка (владелец: «центрируй надпись, чтобы
    // прям по центру свободного пространства»).
    expect(sidebarHeader).toMatch(/\.panel-header-status\s*\{[^}]*justify-content:\s*center/)
  })

  it('значки не прячутся: состояние занимает только пустое место', () => {
    // Владелец: «не убирай значки, прямо в пустом месте рисуй, но чтобы значки не
    // перекрывало». Поэтому истории и правая группа — без условий.
    expect(sidebarHeader).toContain('v-if="view === \'chats\'"')
    expect(sidebarHeader).not.toContain('connectionBusy')
    // Значки фиксированного размера: иначе пилюля выдавила бы их за край шапки.
    expect(sidebarHeader).toContain('.panel-header :deep(.stories-wrap)')
    expect(sidebarHeader).toContain('flex-shrink: 0')
  })

  it('показывает три состояния связи и тихие часы', () => {
    // Тексты и «когда что показывать» живут в общем композабле (см.
    // `useConnectionNotice.ts`): по тому же правилу шапка решает, сколько
    // кружков историй показать рядом (`storiesHeader.spec.ts`).
    expect(notice).toContain("t('Нет сети')")
    expect(notice).toContain("t('Соединение…')")
    // В пилюле текст короткий (место — только промежуток между значками),
    // полная фраза осталась в подсказке.
    expect(notice).toContain("t('Связь есть')")
    expect(notice).toContain("t('Связь восстановлена')")
    expect(status).toContain("t('Тихие часы')")
    // Состояние общее с догрузкой пропущенного, а не своя копия таймеров.
    expect(notice).toContain('useOnlineStatus()')
    // Пилюля берёт это правило, а не считает своё.
    expect(status).toContain('useConnectionNotice()')
    // Без связи пилюля нажимается: проверить связь не ожидая маяка.
    expect(status).toContain('recheck')
  })

  it('«Соединение…» видно и пока связь впервые проверяется', () => {
    // Раньше состояние сразу после запуска было «связь есть» без проверки:
    // догрузка на быстрой сети заканчивалась за доли секунды, и «Соединение…»
    // не успевало появиться ни разу.
    expect(onlineStatus).toContain('checking')
    expect(onlineStatus).toContain("if (checking.value || syncing.value) return 'connecting'")
    expect(notice).toContain("state.value === 'connecting'")
  })

  it('у новых строк есть английский перевод', () => {
    expect(en).toContain("'Нет сети': 'No network'")
    expect(en).toContain("'Связь есть': 'Back online'")
    expect(en).toContain("'Тихие часы: уведомления не приходят'")
  })
})

describe('связь в открытом чате', () => {
  it('подпись про обрыв важнее присутствия собеседника', () => {
    // Присутствие приходит по сети: при обрыве про собеседника всё равно ничего
    // не узнать, поэтому показываем своё состояние.
    expect(chatHeader).toContain('useOnlineStatus()')
    expect(chatHeader).toContain('v-if="connectionText"')
    expect(chatHeader.indexOf('v-if="connectionText"')).toBeLessThan(
      chatHeader.indexOf('v-else-if="peerTyping"')
    )
    expect(chatHeader).toContain("t('Нет сети')")
    // Состояние — общее с пилюлей шапки списка, а не своя копия условий.
    expect(chatHeader).toContain('state: connectionState')
  })
})

describe('полоса сверху осталась только вне мессенджера', () => {
  it('маска маршрутов мессенджера спрятала полосу', () => {
    expect(app).toContain('MESSENGER_ROUTES')
    expect(app).toContain('<OfflineBanner v-if="showConnectionBanner" />')
    // Маршруты мессенджера — все, что рисуют шапки со связью.
    for (const name of ['Messenger', 'ProfileLink', 'ChannelLink', 'GroupInvite']) {
      expect(app).toContain(`'${name}'`)
    }
  })

  it('сама полоса нужна для экрана входа', () => {
    expect(banner).toContain('Нет подключения к интернету')
    expect(banner).toContain('top: 0')
  })
})
