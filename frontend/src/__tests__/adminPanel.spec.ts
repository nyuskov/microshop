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
const rows = readFileSync('src/assets/rows.css', 'utf8')
const header = readFileSync('src/components/messenger/SidebarHeader.vue', 'utf8')
const profile = readFileSync('src/views/UserProfile.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

describe('шестерёнка админа в сайдбаре', () => {
  it('показывается только администратору и открывает админскую панель', () => {
    expect(sidebar).toMatch(/v-if="isAdmin && !selectionMode"/)
    expect(sidebar).toMatch(/class="admin-gear"/)
    expect(sidebar).toMatch(/@click="emit\('open-admin'\)"/)
  })

  it('это только значок — без подписи «Администрирование»', () => {
    // Подпись убрана: строка во всю ширину с текстом читалась как ещё один
    // раздел списка чатов. Смысл кнопки объясняют title и aria-label.
    expect(sidebar).not.toMatch(/<span>Администрирование<\/span>/)
    expect(sidebar).toMatch(/class="admin-gear"[\s\S]{0,200}<q-icon/)
    expect(sidebar).toMatch(/title="Администрирование"[\s\S]{0,120}aria-label="Администрирование"/)
  })

  it('плавающий круглый значок в левом нижнем углу, с учётом безопасной зоны', () => {
    // Требование: это КНОПКА-КРУЖОК поверх списка, как кнопка «вниз» в ленте,
    // а не строка/полоса во всю ширину панели (ту читали как ещё один раздел).
    expect(sidebar).toMatch(/\.admin-gear \{[\s\S]*?position: absolute;/)
    expect(sidebar).toMatch(/left: 12px;/)
    expect(sidebar).toMatch(/bottom: calc\(12px \+ env\(safe-area-inset-bottom/)
    expect(sidebar).toMatch(/border-radius: 50%;/)
    expect(sidebar).toMatch(/box-shadow: var\(--ms-shadow-md/)
    // Размер — как у значка профиля в шапке (.self-profile-btn: круг 40px).
    expect(sidebar).toMatch(/width: 40px;\s*\n\s*height: 40px;/)
    // Абсолютное позиционирование считает координаты от панели, а не от окна.
    expect(sidebar).toMatch(/\.side-panel \{[\s\S]*?position: relative;/)
  })

  it('не отбирает высоту у списка и не прячет последнюю строку', () => {
    // В потоке кнопки нет (иначе она сжимала бы список), зато списку добавляем
    // запас снизу — иначе последний чат уезжает под плавающий кружок.
    expect(sidebar).not.toMatch(/\.admin-gear \{[\s\S]*?flex: none;/)
    expect(sidebar).toMatch(/'has-admin-gear': isAdmin && !selectionMode/)
    expect(rows).toMatch(/\.ms-rows\.has-admin-gear \.chat-scroll \{[\s\S]*?padding-bottom: 60px;/)
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
