/**
 * «Эффект одного эмодзи»: сообщение из единственного эмодзи рассыпается
 * частицами по экрану — как в Telegram при отправке ❤️, 👍, 🔥, 🎉, ⭐.
 *
 * Почему своими руками. У Telegram эти эффекты — готовый набор анимаций (в
 * нативном клиенте это Lottie/Rive-сцены, «.tgs»/«.riv» на 100–300 КБ каждый).
 * Подключить такую библиотеку мы не можем: бюджет сборки — 3 % и 2 КБ на чанк
 * (`scripts/check-bundle-size.mjs`), а библиотека одна на всё приложение и
 * тянется в основной чанк. Зато сам эффект — это «одни и те же частицы»:
 * несколько эмодзи, летящих вверх с разбросом. Их рисует браузер (файл шрифта
 * эмодзи в системе уже есть), а движение даёт Web Animations API: ноль
 * килобайт ассетов и ноль зависимостей.
 *
 * Кому нельзя — тому не показываем: при `prefers-reduced-motion` выходим молча
 * (CSS-правило из `assets/a11y.css` до WAAPI не достаёт, проверка нужна в JS).
 * Там, где `Element.animate` нет вовсе (jsdom в тестах, очень старый движок),
 * тоже молчим: сообщение всё равно ушло и дорисовалось в ленте.
 */

import { prefersReducedMotion } from '@/composables/useFlyingEmoji'

export type EmojiEffectKey = 'hearts' | 'thumbs' | 'party' | 'fire' | 'star'

export interface EmojiEffectRule {
  /** Какие эмодзи летят: сам знак и его «соседи» по смыслу. */
  glyphs: string[]
  /** Сколько частиц за один эффект. */
  count: number
  /** Базовый размер частицы, px (дальше — разброс ±30 %). */
  size: number
  /** Высота подъёма, доля высоты экрана (0…1). */
  rise: number
  /** Разброс по горизонтали, доля ширины экрана (0…1). */
  spread: number
  /** Пауза между частицами, с (эффект идёт волной, а не разом). */
  stagger: number
  /** Сколько живёт частица, с. */
  duration: number
}

/**
 * Набор эффектов. Кривая и «пружинка» здесь те же, что у движений интерфейса
 * (`--ms-ease` = `cubic-bezier(0.22, 1, 0.36, 1)`): разгон и мягкое торможение,
 * поэтому частицы читаются как подброшенные, а не как перетаскиваемые.
 */
export const EMOJI_EFFECTS: Readonly<Record<EmojiEffectKey, EmojiEffectRule>> = {
  hearts: {
    glyphs: ['❤️', '💖', '💕'],
    count: 14,
    size: 26,
    rise: 0.62,
    spread: 0.5,
    stagger: 0.07,
    duration: 2.4
  },
  thumbs: {
    glyphs: ['👍'],
    count: 12,
    size: 26,
    rise: 0.55,
    spread: 0.45,
    stagger: 0.08,
    duration: 2.2
  },
  party: {
    glyphs: ['🎉', '🎊', '✨'],
    count: 16,
    size: 24,
    rise: 0.6,
    spread: 0.72,
    stagger: 0.06,
    duration: 2.6
  },
  fire: {
    glyphs: ['🔥'],
    count: 12,
    size: 26,
    rise: 0.5,
    spread: 0.5,
    stagger: 0.07,
    duration: 1.8
  },
  star: {
    glyphs: ['⭐', '🌟', '✨'],
    count: 12,
    size: 24,
    rise: 0.6,
    spread: 0.6,
    stagger: 0.08,
    duration: 2.4
  }
}

/**
 * Одиночный эмодзи → эффект. `❤` без селектора начертания — тот же «сердечный»
 * эффект, что и `❤️`: клавиатуры и старые сборки присылают обе формы.
 */
const EMOTICON_EFFECTS: Readonly<Record<string, EmojiEffectKey>> = {
  '❤️': 'hearts',
  '❤': 'hearts',
  '👍': 'thumbs',
  '🔥': 'fire',
  '🎉': 'party',
  '⭐': 'star'
}

/** Слой эффекта на время показа: один на экран, чтобы не копить частицы. */
let activeOverlay: HTMLElement | null = null

/**
 * Эффект для текста сообщения или null. Срабатывает ТОЛЬКО если всё сообщение —
 * один эмодзи: «привет ❤️» частиц не даёт (как в Telegram, где эффект — про
 * сообщение целиком, а не про встреченный по пути смайл).
 */
export function emojiEffectForText(text: string): EmojiEffectKey | null {
  const trimmed = text.trim()
  // Длиннее четырёх единиц (эмодзи + селектор начертания) одиночным быть не
  // может — отсекаем до обращения к таблице.
  if (!trimmed || trimmed.length > 4) return null
  return EMOTICON_EFFECTS[trimmed] ?? null
}

/** Убирает слой прошлого эффекта: две отправки подряд не наслаиваются. */
function dropOverlay(): void {
  activeOverlay?.remove()
  activeOverlay = null
}

/**
 * Показать эффект. Частицы поднимаются от низа экрана с разбросом и тают — то
 * же ощущение, что у Telegram, только вместо готовой сцены обычные элементы.
 */
export function playEmojiEffect(kind: EmojiEffectKey): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (!document.body) return
  if (prefersReducedMotion()) return
  // Проверяем ДО создания слоя: там, где анимации нет, на экране не должно
  // остаться ни одного узла (jsdom в тестах, древние движки).
  if (typeof document.createElement('span').animate !== 'function') return

  dropOverlay()

  const rule = EMOJI_EFFECTS[kind]
  const overlay = document.createElement('div')
  overlay.className = 'emoji-effect'
  overlay.setAttribute('aria-hidden', 'true')
  // Стили — инлайном: слой живёт на <body> вне scope компонента, а заводить
  // ради него отдельный CSS-файл незачем (как и полёт реакции).
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    // Выше ленты и полёта реакции, но НИЖЕ окон (6000): эффект украшает чат и
    // не должен накрывать открытый диалог.
    zIndex: 'var(--ms-z-effect, 5400)'
  })
  document.body.append(overlay)
  activeOverlay = overlay

  const width = window.innerWidth || 360
  const height = window.innerHeight || 640
  const animations: Animation[] = []
  const at = (fraction: number) => ({ offset: fraction })

  for (let index = 0; index < rule.count; index += 1) {
    const node = document.createElement('span')
    node.textContent = rule.glyphs[index % rule.glyphs.length]
    node.setAttribute('aria-hidden', 'true')
    // Разброс по горизонтали и размер — «живой»: ровный ряд частиц читался бы
    // как узор, а не как рассыпавшийся эмодзи.
    const startX = width * (0.5 - rule.spread / 2) + Math.random() * width * rule.spread
    const drift = (Math.random() - 0.5) * width * rule.spread * 0.6
    const rise = height * rule.rise * (0.7 + Math.random() * 0.5)
    const size = Math.round(rule.size * (0.7 + Math.random() * 0.6))
    const turn = Math.round((Math.random() - 0.5) * 60)
    Object.assign(node.style, {
      position: 'absolute',
      left: `${Math.round(startX)}px`,
      bottom: `-${size}px`,
      fontSize: `${size}px`,
      lineHeight: '1',
      willChange: 'transform, opacity'
    })
    overlay.append(node)

    animations.push(
      node.animate(
        [
          { ...at(0), transform: 'translate(0, 0) scale(0.5) rotate(0deg)', opacity: 0 },
          {
            ...at(0.25),
            transform: `translate(${Math.round(drift * 0.4)}px, -${Math.round(rise * 0.3)}px) scale(1) rotate(${Math.round(turn * 0.5)}deg)`,
            opacity: 1
          },
          {
            ...at(1),
            transform: `translate(${Math.round(drift)}px, -${Math.round(rise)}px) scale(0.9) rotate(${turn}deg)`,
            opacity: 0
          }
        ],
        {
          duration: rule.duration * 1000,
          delay: index * rule.stagger * 1000,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards'
        }
      )
    )
  }

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    if (activeOverlay === overlay) activeOverlay = null
    overlay.remove()
  }
  Promise.allSettled(animations.map((animation) => animation.finished))
    .then(finish)
    .catch(finish)
  // Страховка: если кадры не идут (вкладка в фоне), слой всё равно уйдёт и не
  // останется висеть поверх приложения.
  window.setTimeout(finish, (rule.duration + rule.stagger * rule.count) * 1000 + 600)
}

/** Короткий вызов для отправки: «сообщение → эффект, если это один эмодзи». */
export function playEmojiEffectForText(text: string): void {
  const kind = emojiEffectForText(text)
  if (kind) playEmojiEffect(kind)
}
