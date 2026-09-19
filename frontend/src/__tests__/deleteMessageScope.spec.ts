/**
 * Удаление сообщения: выбор «только у меня» или «для всех».
 *
 * Раньше удаление было одно и уносило сообщение у ВСЕХ участников: у диалога не
 * было ни выбора, ни галки, а человек, желая убрать строку только у себя,
 * удалял её и у собеседника. Эти проверки держат главное: выбор есть, «для всех»
 * предлагается только там, где он возможен, и до сервера область доезжает
 * параметром `for_all` (по умолчанию сервер считает `true` — так работали
 * прежние клиенты).
 *
 * Тесты читают исходники: собранный диалог зависит от Quasar (`q-dialog`,
 * `q-radio`), а проверяем мы договорённости — какая область выбрана по умолчанию,
 * кто её спрашивает и что уходит в запрос.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(path, 'utf8')

const dialog = read('src/components/messenger/DeleteMessageDialog.vue')
const service = read('src/services/chatService.ts')
const selection = read('src/composables/useMessageSelection.ts')
const messenger = read('src/views/Messenger.vue')
const bar = read('src/components/messenger/MessageActionsBar.vue')
const sheet = read('src/components/messenger/MessageActionSheet.vue')
const router = read('src/router/index.ts')
const authPage = read('src/views/AuthPage.vue')

describe('диалог удаления сообщения', () => {
  it('галка снята по умолчанию — «только у меня»', () => {
    expect(dialog).toMatch(/const forAll = ref\(false\)/)
  })

  it('как в Телеграме: одна галка вместо двух вариантов', () => {
    expect(dialog).toContain('q-checkbox')
    expect(dialog).not.toContain('q-radio')
  })

  it('галка о собеседнике показывается только когда это возможно', () => {
    // Чужое сообщение удалить у всех нельзя: сервер отвечает 403, а галочка,
    // которая всегда даёт ошибку, — обман.
    expect(dialog).toContain('v-if="canDeleteForAll && forAllLabel"')
  })

  it('подтверждение отдаёт область по галке, а закрытие — отмену', () => {
    expect(dialog).toContain("emit('confirm', forAll ? 'all' : 'me')")
    expect(dialog).toContain("emit('close')")
  })

  it('подпись галки — с именем собеседника', () => {
    // Пустая подпись (группа-сам с собой/некуда удалять) = галки нет.
    expect(messenger).toMatch(/Удалить для \$\{chatTitle\(chat, currentUserId\.value\)\}/)
    expect(messenger).toContain("'Удалить для всех'")
    expect(messenger).toMatch(/if \(!chat \|\| chat\.is_self\) return ''/)
  })
})

describe('запрос на сервер', () => {
  it('область уезжает параметром for_all', () => {
    expect(service).toContain('params: { for_all: String(forAll) }')
  })
})

describe('где предлагается удаление', () => {
  it('чужое сообщение тоже можно убрать — «у себя»', () => {
    // Раньше пункт был под `v-if="isOwn"`: чужое сообщение убрать было нельзя.
    expect(bar).not.toMatch(/v-if="isOwn"[^>]*@click="onDelete"/)
    expect(bar).toContain("{{ isOwn ? 'Удалить' : 'Удалить у себя' }}")
    expect(sheet).toContain("{{ isOwn ? 'Удалить' : 'Удалить у себя' }}")
  })

  it('массовое удаление спрашивает область и удаляет всё выбранное', () => {
    expect(selection).toContain('askDeleteScope')
    expect(selection).toContain("deleteMessage(message.id, scope === 'all')")
    // «Для всех» — только если ВСЁ выбранное своё.
    expect(selection).toMatch(/targets\.every\(/)
  })

  it('одиночное удаление спрашивает область и знает про авторство', () => {
    expect(messenger).toMatch(/canForAll: message\.user_id === currentUserId\.value/)
    expect(messenger).toMatch(/deleteMessage\(message\.id, scope === 'all'\)/)
  })
})

describe('страница входа по центру', () => {
  it('вход и приглашение идут через общую обёртку', () => {
    // Прямой компонент в роутере давал карточку у ВЕРХА окна: центровкой
    // занималась модалка (`LoginModal` → `q-dialog`), а у страницы её не было.
    expect(router).toContain('component: AuthPage')
    expect(router).toContain("props: { kind: 'login' }")
    expect(router).toContain("props: { kind: 'invite' }")
  })

  it('обёртка центрирует по видимой области (клавиатура учтена)', () => {
    expect(authPage).toContain('align-items: center')
    expect(authPage).toContain('justify-content: center')
    expect(authPage).toContain('min-height: var(--ms-vv-h, 100dvh)')
  })
})
