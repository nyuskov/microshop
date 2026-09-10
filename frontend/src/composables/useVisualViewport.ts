import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Высота видимой области с учётом экранной клавиатуры.
 *
 * Проблема: каркас приложения жёстко занимает экран (`position: fixed`), а при
 * открытии клавиатуры браузер (Android Chrome, iOS Safari) уменьшает именно
 * *визуальную* область, не меняя layout-viewport. Из-за этого поле ввода уезжает
 * под клавиатуру, а лента сообщений «прыгает».
 *
 * Решение: отдаём реальную высоту и смещение визуальной области в CSS-переменные
 * (`--ms-vv-h`, `--ms-vv-top`), а каркас в CSS берёт их вместо 100%/0. В
 * Android-приложении клавиатура ресайзит окно (`adjustResize`) — там значения
 * совпадают с обычными, и поведение не меняется.
 */
export function useVisualViewport(): void {
  let frame = 0

  const apply = () => {
    frame = 0
    const viewport = window.visualViewport
    const root = document.documentElement
    if (!viewport) {
      root.style.removeProperty('--ms-vv-h')
      root.style.removeProperty('--ms-vv-top')
      return
    }
    root.style.setProperty('--ms-vv-h', `${Math.round(viewport.height)}px`)
    root.style.setProperty('--ms-vv-top', `${Math.round(viewport.offsetTop)}px`)
  }

  // Частые события (клавиатура, инерционная прокрутка) — считаем не чаще кадра.
  const schedule = () => {
    if (frame !== 0) return
    frame = requestAnimationFrame(apply)
  }

  onMounted(() => {
    apply()
    const viewport = window.visualViewport
    if (!viewport) return
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
  })

  onBeforeUnmount(() => {
    if (frame !== 0) cancelAnimationFrame(frame)
    const viewport = window.visualViewport
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('orientationchange', schedule)
  })
}
