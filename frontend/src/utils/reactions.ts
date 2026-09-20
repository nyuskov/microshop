import type { Message } from '@/types'

/**
 * Реакции: наборы эмодзи и «последняя использованная» реакция.
 *
 * Списки и правила жили прямо в разметке `MessageRow.vue` — здесь они в одном
 * месте, поэтому одинаковы и для мини-панели сообщения (быстрые реакции), и для
 * полной палитры, и проверяются тестами без DOM.
 */

/** Полный набор реакций (раскрывается по «Все реакции»). */
export const REACTION_EMOJIS: readonly string[] = [
  '👍',
  '❤️',
  '🔥',
  '😂',
  '🤣',
  '😮',
  '😢',
  '😭',
  '😡',
  '🎉',
  '👏',
  '🙏',
  '🤔',
  '🤯',
  '🥰',
  '😍',
  '😎',
  '😴',
  '🤝',
  '💯',
  '👎',
  '❤️‍🔥'
]

/** Быстрые реакции: первая строка мини-панели сообщения. */
export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '🎉']

/** Реакция «по умолчанию» для двойного тапа, если человек ещё ничего не ставил. */
export const DEFAULT_QUICK_REACTION = '❤️'

/** Ключ в localStorage: какую реакцию ставить двойным тапом. */
export const QUICK_REACTION_KEY = 'pismo_quick_reaction'

/** Ставил ли я уже эту реакцию на сообщение (для подсветки в палитре). */
export function hasMyReaction(message: Message, emoji: string): boolean {
  return message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)
}

/**
 * Последняя использованная реакция — её ставит двойной тап.
 *
 * В приватном режиме localStorage недоступен: тогда ведём себя как при первом
 * запуске и просто отдаём реакцию по умолчанию.
 */
export function lastQuickReaction(): string {
  try {
    return localStorage.getItem(QUICK_REACTION_KEY) || DEFAULT_QUICK_REACTION
  } catch {
    return DEFAULT_QUICK_REACTION
  }
}

/** Запомнить реакцию, выбранную вручную, чтобы двойной тап ставил её же. */
export function rememberQuickReaction(emoji: string): void {
  try {
    localStorage.setItem(QUICK_REACTION_KEY, emoji)
  } catch {
    /* приватный режим — просто не запомним */
  }
}
