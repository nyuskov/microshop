/**
 * Что делает свайп ВЛЕВО по строке чата (телефон).
 *
 * Правый свайп всегда закрепляет — это действие легко отменить повторным
 * жестом, и вопросов «зачем» не вызывает. Левый в Телеграме настраивается, и у
 * нас есть три осмысленных варианта: «в архив» (было по умолчанию),
 * «выключить/включить уведомления» (самое частое действие над шумным чатом) и
 * «отметить прочитанным» (снять счётчик, не открывая чат).
 *
 * Хранится на устройстве (`localStorage`), как папки и архив: это привычка
 * пальца, а не свойство аккаунта.
 */
import { ref } from 'vue'

export const CHAT_SWIPE_KEY = 'pismo_chat_swipe_left'

export const CHAT_SWIPE_ACTIONS = ['archive', 'mute', 'read'] as const

export type ChatSwipeAction = (typeof CHAT_SWIPE_ACTIONS)[number]

/**
 * Варианты для настроек: подпись = что сделает жест.
 *
 * Подписи — ключи перевода (русский текст), а не готовые строки: константа
 * объявлена на уровне модуля, и вызов `t()` здесь застыл бы на языке,
 * который был при загрузке. Переводит тот, кто рисует (`AppearanceSettings`).
 */
export const CHAT_SWIPE_OPTIONS: readonly { key: ChatSwipeAction; label: string; hint: string }[] =
  [
    {
      key: 'archive',
      label: 'В архив',
      hint: 'Чат скрывается из списка, вернуть — из фильтра «Архив»'
    },
    {
      key: 'mute',
      label: 'Уведомления',
      hint: 'Выключает и включает уведомления по этому чату'
    },
    {
      key: 'read',
      label: 'Отметить прочитанным',
      hint: 'Снимает счётчик непрочитанных, чат остаётся в списке'
    }
  ]

const isAction = (value: unknown): value is ChatSwipeAction =>
  typeof value === 'string' && (CHAT_SWIPE_ACTIONS as readonly string[]).includes(value)

/** Читает настройку; мусор и запрет localStorage дают вариант по умолчанию. */
export function readChatSwipeAction(
  storage: Storage | undefined = globalThis.localStorage
): ChatSwipeAction {
  try {
    const raw = storage?.getItem(CHAT_SWIPE_KEY)
    return isAction(raw) ? raw : 'archive'
  } catch {
    return 'archive'
  }
}

/** Общее состояние: панель чатов и настройки не должны расходиться. */
export const chatSwipeAction = ref<ChatSwipeAction>(readChatSwipeAction())

/** Сохраняет выбор и сразу применяет его к жесту. */
export function writeChatSwipeAction(
  action: ChatSwipeAction,
  storage: Storage | undefined = globalThis.localStorage
): void {
  chatSwipeAction.value = action
  try {
    storage?.setItem(CHAT_SWIPE_KEY, action)
  } catch {
    // Приватный режим: настройка живёт до перезагрузки — это лучше, чем падать.
  }
}
