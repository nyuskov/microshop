import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Админская панель: «шестерёнка» внизу слева и служебные разделы внутри неё.
 *
 * Смысл проверки — чтобы служебные вещи (приглашения, жалобы) не расползались
 * обратно в обычные настройки профиля и оставались доступны только
 * администратору: у обычного пользователя нет ни кнопки, ни раздела.
 * jsdom не считает ни раскладку, ни видимость, поэтому читаем исходники.
 */
const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')
const header = readFileSync('src/components/messenger/SidebarHeader.vue', 'utf8')
const profile = readFileSync('src/views/UserProfile.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

describe('шестерёнка админа в сайдбаре', () => {
  it('показывается только администратору и открывает админскую панель', () => {
    expect(sidebar).toMatch(/v-if="isAdmin && !selectionMode"/)
    expect(sidebar).toMatch(/class="admin-gear"/)
    expect(sidebar).toMatch(/@click="emit\('open-admin'\)"/)
  })

  it('прижата к низу панели и учитывает безопасную зону экрана', () => {
    // Кнопка в самом низу: без safe-area она уходит под системную полоску.
    expect(sidebar).toMatch(/env\(safe-area-inset-bottom/)
    expect(sidebar).toMatch(/border-top: 1px solid var\(--ms-border\)/)
  })

  it('«Жалобы» больше не живут в меню «⋯»', () => {
    expect(header).not.toContain('reports')
    expect(header).not.toContain('isAdmin')
  })

  it('в Messenger шестерёнка открывает настройки сразу на админском экране', () => {
    expect(messenger).toMatch(/@open-admin="goToAdmin"/)
    expect(messenger).toMatch(/profileStartSection\.value = 'admin'/)
    // Профиль — асинхронный компонент: начальный экран передаём пропом,
    // иначе на первом открытии «шестерёнка» открывала бы обычные настройки.
    expect(messenger).toMatch(/:start-section="profileStartSection"/)
  })

  it('«Жалобы» из админской панели открывают диалог модерации', () => {
    expect(messenger).toMatch(/@open-moderation="openModerationFromAdmin"/)
    expect(messenger).toMatch(/moderationOverlaysRef\.value\?\.openReports\(\)/)
  })
})

describe('админские разделы отделены от обычных настроек', () => {
  it('в списке обычных разделов нет приглашений', () => {
    // Режем исходник по объявлениям списков: до ADMIN_ROWS — обычные разделы.
    const userRows = profile.split('const SETTINGS_ROWS')[1].split('const ADMIN_ROWS')[0]
    const adminRows = profile.split('const ADMIN_ROWS')[1].split('const section =')[0]

    expect(userRows).not.toContain("key: 'invites'")
    expect(adminRows).toContain("key: 'invites'")
    expect(adminRows).toContain("key: 'reports'")
  })

  it('админский экран рисуется по section === "admin"', () => {
    expect(profile).toMatch(/v-if="section === 'admin'"/)
    expect(profile).toMatch(/aria-label="Разделы администрирования"/)
  })

  it('«назад» из админского раздела возвращает к админскому списку', () => {
    expect(profile).toMatch(/section\.value = section\.value === 'invites' \? 'admin' : 'root'/)
  })

  it('на админском экране нет внутренней шапки со стрелкой «к разделам»', () => {
    // Заголовок даёт само окно («Администрирование»), а стрелка уводила бы в
    // обычный профиль, к которому человек не шёл. Возврат — закрытием окна
    // (крестик) или системным «назад».
    expect(profile).toMatch(/v-if="section !== 'root' && section !== 'admin'"/)
    expect(profile).not.toMatch(/v-if="section !== 'admin"[\s\S]{0,200}settings-back/)
  })

  it('окно настроек называется по текущему экрану', () => {
    expect(messenger).toMatch(
      /profileStartSection\.value === 'admin' \? 'Администрирование' : 'Настройки'/
    )
    expect(messenger).toMatch(/\{\{ profileTitle \}\}/)
  })

  it('системный «назад» с админского экрана закрывает настройки, а не уводит в профиль', () => {
    expect(profile).toMatch(
      /const isInSection = \(\) => section\.value !== 'root' && section\.value !== 'admin'/
    )
  })
})
