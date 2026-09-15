/**
 * Какой слой закрывает системное «назад».
 *
 * Логика вынесена из `Messenger.vue` именно из-за регрессий в ней: кейс
 * «Контакты → контакт → чат → назад» ломался, потому что шаг менял раздел, но
 * не показывал список — нить чата оставалась на экране, и «назад» выглядел
 * неработающим.
 */

import { describe, expect, it } from 'vitest'

import { decideBackStep, type BackSnapshot } from '@/utils/mobileNav'

/** Снимок: человек на списке чатов, ничего не открыто. */
const base: BackSnapshot = {
  storyOpen: false,
  lightboxOpen: false,
  profileOpen: false,
  profileInSection: false,
  chatInfoOpen: false,
  groupInfoOpen: false,
  createGroupOpen: false,
  inviteOpen: false,
  messageSelection: false,
  chatSelection: false,
  currentView: 'chats',
  previousView: undefined,
  chatOpen: false,
  drawerOpen: true,
  twoPane: false
}

const step = (patch: Partial<BackSnapshot> = {}) => decideBackStep({ ...base, ...patch })

describe('decideBackStep', () => {
  it('закрывает верхние слои по одному, от верхнего к нижнему', () => {
    expect(step({ storyOpen: true, lightboxOpen: true })).toEqual({ kind: 'story' })
    expect(step({ lightboxOpen: true, profileOpen: true })).toEqual({ kind: 'lightbox' })
    expect(step({ profileOpen: true, profileInSection: true })).toEqual({ kind: 'profile-section' })
    expect(step({ profileOpen: true, chatInfoOpen: true })).toEqual({ kind: 'overlays' })
    expect(step({ groupInfoOpen: true })).toEqual({ kind: 'overlays' })
    expect(step({ createGroupOpen: true })).toEqual({ kind: 'overlays' })
  })

  it('закрывает карточку приглашения в группу (пришёл по ссылке)', () => {
    // Человек открыл `/j/<токен>`: карточка — верхний слой, «назад» закрывает
    // её, а не выводит из приложения.
    expect(step({ inviteOpen: true })).toEqual({ kind: 'invite' })
    expect(step({ inviteOpen: true, chatOpen: true })).toEqual({ kind: 'invite' })
  })

  it('выходит из режимов выделения, а не уводит из чата', () => {
    expect(step({ messageSelection: true, chatOpen: true })).toEqual({
      kind: 'message-selection'
    })
    expect(step({ chatSelection: true })).toEqual({ kind: 'chat-selection' })
  })

  it('возвращает в раздел и просит показать его список (регрессия: Контакты → контакт → чат)', () => {
    expect(
      step({ currentView: 'chats', previousView: 'contacts', chatOpen: true, drawerOpen: false })
    ).toEqual({ kind: 'section', section: 'contacts', showList: true })
  })

  it('в двухпанельном режиме drawer не трогаем — раздел и так виден', () => {
    expect(
      step({
        twoPane: true,
        currentView: 'chats',
        previousView: 'contacts',
        chatOpen: true,
        drawerOpen: false
      })
    ).toEqual({ kind: 'section', section: 'contacts', showList: false })
  })

  it('без раздела в маркере возвращает в «Чаты» и показывает список', () => {
    expect(step({ currentView: 'contacts', chatOpen: true, drawerOpen: false })).toEqual({
      kind: 'section',
      section: 'chats',
      showList: true
    })
  })

  it('закрывает открытую нить, когда списка на экране нет', () => {
    expect(step({ chatOpen: true, drawerOpen: false })).toEqual({ kind: 'list' })
  })

  it('на корне отдаёт решение системе (выход из приложения)', () => {
    expect(step()).toEqual({ kind: 'exit' })
    expect(step({ chatOpen: true, drawerOpen: true })).toEqual({ kind: 'exit' })
  })
})
