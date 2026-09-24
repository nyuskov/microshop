/**
 * Летящий эмодзи реакции: из кнопки (палитры) в чипы сообщения.
 *
 * Зачем: чип «выстреливает» на месте (см. `reaction-pop` в `MessageRow.vue`), но
 * связь «я нажал вон там» → «чип появился вот здесь» глаз не простраивает сам.
 * Короткий полёт (0,36 с) объясняет, что произошло, и жест становится живым —
 * как реакция в Telegram.
 *
 * Без библиотек: один элемент и Web Animations API. Новая зависимость (Lottie и
 * подобное) весит 150–300 КБ в основном чанке, а бюджет у нас 3 % и 2 КБ на
 * чанк — поэтому движение делаем кодом, а не готовой анимацией.
 *
 * Если браузер не умеет `animate` (jsdom в тестах, старые движки) или человек
 * просил «уменьшить движение» — молча ничего не делаем: чип всё равно появится
 * своим появлением, полёт лишь украшение.
 */
export interface EmojiPoint {
  x: number
  y: number
}

/** Сколько летит эмодзи (совпадает с появлением чипа — они стыкуются). */
const FLY_MS = 360

/** Просил ли человек меньше движения: тогда полёт не показываем. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Показать летящий эмодзи от `from` к `to` (координаты — центр, в пикселях окна).
 *
 * Кривая — та же, что у движений интерфейса (`--ms-ease`,
 * `cubic-bezier(.22,1,.36,1)`): быстрый разгон и мягкое торможение, поэтому
 * полёт читается как «бросок», а не как перетаскивание.
 */
export function flyEmoji(emoji: string, from: EmojiPoint, to: EmojiPoint): void {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') return
  if (prefersReducedMotion()) return

  const node = document.createElement('span')
  node.textContent = emoji
  node.setAttribute('aria-hidden', 'true')
  // Стили — инлайново: элемент живёт на <body> вне scope компонента, а держать
  // ради него отдельный CSS-файл незачем.
  Object.assign(node.style, {
    position: 'fixed',
    left: `${Math.round(from.x)}px`,
    top: `${Math.round(from.y)}px`,
    fontSize: '22px',
    lineHeight: '1',
    pointerEvents: 'none',
    // Выше окон приложения (6000 только у диалогов), но ниже тостов-ошибок.
    zIndex: '5500',
    willChange: 'transform, opacity'
  })
  document.body.append(node)

  if (typeof node.animate !== 'function') {
    node.remove()
    return
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  const at = (x: number, y: number, scale: number, opacity: number) => ({
    transform: `translate(calc(-50% + ${Math.round(x)}px), calc(-50% + ${Math.round(y)}px)) scale(${scale})`,
    opacity: String(opacity)
  })

  const animation = node.animate(
    [
      { ...at(0, 0, 0.6, 0.85), offset: 0 },
      // Полёт по дуге: середина пути чуть выше прямой — как подброшенный предмет.
      { ...at(dx * 0.5, dy * 0.5 - 26, 1.5, 1), offset: 0.45 },
      { ...at(dx, dy, 1, 1), offset: 1 }
    ],
    { duration: FLY_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
  )

  let removed = false
  const done = () => {
    if (removed) return
    removed = true
    node.remove()
  }
  animation.finished.then(done).catch(done)
  // Страховка: если кадры не идут (вкладка в фоне), элемент всё равно уйдёт.
  window.setTimeout(done, FLY_MS + 600)
}
