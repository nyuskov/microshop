/**
 * Эмодзи для панели в поле ввода: категории + недавние.
 *
 * Раньше был один длинный список без памяти и без категорий — нужный смайл
 * приходилось искать глазами по всей сетке. Теперь сверху «Недавние»
 * (запоминаем последние выбранные), ниже — категории.
 */
export interface EmojiGroup {
  key: string
  title: string
  items: string[]
}

/** Ключ localStorage со списком недавних эмодзи (по устройству). */
export const EMOJI_RECENT_KEY = 'pismo_emoji_recent'

/** Сколько недавних храним. */
export const EMOJI_RECENT_LIMIT = 16

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: 'smileys',
    title: 'Смайлы',
    items: [
      '😀',
      '😁',
      '😂',
      '🤣',
      '😊',
      '😍',
      '😘',
      '😜',
      '🤪',
      '😎',
      '🤩',
      '🥳',
      '😇',
      '🙂',
      '😉',
      '😌',
      '😔',
      '😢',
      '😭',
      '😤',
      '😡',
      '🤯',
      '😱',
      '🥶',
      '😴',
      '🤒',
      '🤢',
      '🥺',
      '🤗',
      '🫡',
      '😅',
      '🙃'
    ]
  },
  {
    key: 'gestures',
    title: 'Жесты',
    items: [
      '👍',
      '👎',
      '👏',
      '🙌',
      '🤝',
      '💪',
      '🙏',
      '👌',
      '✌️',
      '🤞',
      '🖐️',
      '🤙',
      '👋',
      '💅',
      '🤘',
      '🫶'
    ]
  },
  {
    key: 'hearts',
    title: 'Сердца',
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💔']
  },
  {
    key: 'symbols',
    title: 'Символы',
    items: [
      '🔥',
      '✨',
      '⭐',
      '🌟',
      '🎉',
      '🎂',
      '🎁',
      '🎊',
      '🚀',
      '🏆',
      '⚽',
      '🏀',
      '🎮',
      '🎧',
      '🎵',
      '🎸'
    ]
  },
  {
    key: 'food',
    title: 'Еда',
    items: ['☕', '🍕', '🍔', '🍟', '🍰', '🌮', '🍣', '🍩', '🍺', '🥂']
  },
  {
    key: 'nature',
    title: 'Разное',
    items: ['🌹', '🌸', '🌈', '☀️', '❄️', '⚡', '🍀', '👀', '💬', '✅', '❌', '❓']
  }
]

/** Читает недавние эмодзи из хранилища (устойчиво к мусору внутри). */
export function readRecentEmoji(storage: Storage | undefined): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(EMOJI_RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, EMOJI_RECENT_LIMIT)
  } catch {
    // Битое значение в localStorage не должно ломать ввод сообщения.
    return []
  }
}

/** Добавляет эмодзи в начало недавних без дублей и обрезает до лимита. */
export function rememberEmoji(recent: string[], emoji: string): string[] {
  return [emoji, ...recent.filter((item) => item !== emoji)].slice(0, EMOJI_RECENT_LIMIT)
}
