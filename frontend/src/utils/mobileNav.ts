/**
 * Решение «какой слой закрывает системное назад».
 *
 * Логика вынесена из `Messenger.vue` в чистую функцию: этот код уже дважды
 * ломался (см. `/memories/repo/mobile-navigation-history.md`), а внутри
 * огромного компонента его нельзя было покрыть тестами. Здесь только выбор
 * шага, без побочных эффектов — их применяет вызывающий.
 */

/** Основные списки drawer'а: Чаты и Контакты. */
export type Section = 'chats' | 'contacts'

export type MobileBackStep =
  /** Закрыть просмотр истории. */
  | { kind: 'story' }
  /** Закрыть просмотр изображения. */
  | { kind: 'lightbox' }
  /** Закрыть комментарии к посту канала (отдельный экран, как в Telegram). */
  | { kind: 'comments' }
  /** Вернуть список разделов внутри профиля. */
  | { kind: 'profile-section' }
  /** Закрыть модалки поверх всего. */
  | { kind: 'overlays' }
  /** Закрыть карточку приглашения в группу (открыта по ссылке `/j/<токен>`). */
  | { kind: 'invite' }
  /** Выйти из режима выбора сообщений. */
  | { kind: 'message-selection' }
  /** Выйти из режима выбора чатов. */
  | { kind: 'chat-selection' }
  /**
   * Вернуться в раздел. `showList` — надо ли заодно показать список раздела
   * (мобильный: если открыта переписка, одного переключения `view` мало —
   * экран не меняется и «назад» выглядит сломанным).
   */
  | { kind: 'section'; section: Section; showList: boolean }
  /** Показать список чатов поверх открытой нити. */
  | { kind: 'list' }
  /** Корень истории — дальше пусть решает система (выход из приложения). */
  | { kind: 'exit' }

export interface BackSnapshot {
  storyOpen: boolean
  lightboxOpen: boolean
  /** Открыт экран комментариев к посту канала. */
  commentsOpen: boolean
  profileOpen: boolean
  /** Открыт ли внутри профиля конкретный раздел (а не список разделов). */
  profileInSection: boolean
  chatInfoOpen: boolean
  groupInfoOpen: boolean
  createGroupOpen: boolean
  /** Открыта карточка приглашения в группу (ссылка `/j/<токен>`). */
  inviteOpen: boolean
  messageSelection: boolean
  chatSelection: boolean
  currentView: Section
  /** Раздел, записанный в маркере истории (`pismoView`). */
  previousView?: Section
  /** Открыта ли переписка (`selectedChatId !== null`). */
  chatOpen: boolean
  drawerOpen: boolean
  /**
   * Список и нить видны одновременно (десктоп и планшет — от 600px). Тогда
   * «назад» не должно показывать список: он и так на экране.
   */
  twoPane: boolean
}

/**
 * Порядок веток важен: закрываем ровно один слой, от верхнего к нижнему.
 * Разбор кейса «Контакты → контакт → чат → назад»: в истории два маркера
 * (раздел и нить), на шаге назад приходит маркер раздела — этого мало, нужно
 * ещё показать список раздела, поэтому вызывающий по шагу `section` на
 * мобильном закрывает переписку и открывает список.
 */
export function decideBackStep(snapshot: BackSnapshot): MobileBackStep {
  /** Нужно ли на этом шаге показать список раздела (телефон). */
  const needsList = !snapshot.twoPane && (snapshot.chatOpen || !snapshot.drawerOpen)

  if (snapshot.storyOpen) return { kind: 'story' }
  if (snapshot.lightboxOpen) return { kind: 'lightbox' }
  // Комментарии открываются из поста и занимают экран целиком — «назад»
  // возвращает в ленту канала, а не закрывает приложение/чат.
  if (snapshot.commentsOpen) return { kind: 'comments' }
  // Приглашение — верхний слой: человек пришёл по ссылке и ещё ничего не
  // открывал, «назад» должно закрыть карточку, а не вывести из приложения.
  if (snapshot.inviteOpen) return { kind: 'invite' }
  if (snapshot.profileOpen && snapshot.profileInSection) return { kind: 'profile-section' }
  if (
    snapshot.profileOpen ||
    snapshot.chatInfoOpen ||
    snapshot.groupInfoOpen ||
    snapshot.createGroupOpen
  ) {
    return { kind: 'overlays' }
  }
  if (snapshot.messageSelection) return { kind: 'message-selection' }
  if (snapshot.chatSelection) return { kind: 'chat-selection' }

  const { previousView } = snapshot
  if (previousView !== undefined && previousView !== snapshot.currentView) {
    return { kind: 'section', section: previousView, showList: needsList }
  }
  if (snapshot.currentView !== 'chats') {
    return { kind: 'section', section: 'chats', showList: needsList }
  }

  if (snapshot.chatOpen && !snapshot.drawerOpen) return { kind: 'list' }

  return { kind: 'exit' }
}
