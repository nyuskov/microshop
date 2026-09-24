import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Экран загрузки (до первого кадра приложения).
 *
 * На слабом телефоне бандл скачивается и разбирается секундами, и всё это время
 * человек видел пустую белую страницу — это и выглядело как «загрузка виснет».
 * Экран обязан быть в `index.html` (то есть виден ещё до JavaScript), показывать
 * ТОЛЬКО кружок ожидания — тот же, что и в приложении («как везде, просто
 * загрузка», владелец 24.09.2026), — и гаснуть сам, без скриптов.
 *
 * Проверки статические: в jsdom `index.html` не участвует, поэтому читаем файл.
 */

const html = readFileSync('index.html', 'utf8')

describe('экран загрузки в index.html', () => {
  it('это кружок ожидания без надписи и логотипа', () => {
    const boot = html.slice(html.indexOf('<div id="boot"'), html.indexOf('<script type="module"'))
    expect(boot).toContain('class="boot-ring"')
    // Ни слова «Pismo», ни любых других видимых надписей: подпись рядом с
    // кружком в приложении убрана намеренно (см. BrandSpinner.vue), и на экране
    // загрузки её тоже быть не должно.
    expect(boot.replace(/<[^>]*>/g, '').trim()).toBe('')
    expect(html).not.toContain('boot-name')
  })

  it('гаснет сам, как только приложение отрисовало первый кадр', () => {
    // Без JavaScript: скрипт может не загрузиться, а белое полотно поверх
    // интерфейса осталось бы навсегда.
    expect(html).toContain('#app:not(:empty) ~ #boot')
    expect(html).toContain('display: none;')
  })

  it('кружок — тот же, что в приложении (размер, толщина, скорость)', () => {
    const spinner = readFileSync('src/components/common/BrandSpinner.vue', 'utf8')
    // Толщина кольца в BrandSpinner считается как size / 14 при минимуме 3:
    // 56 → 4, и вращение 0,9 с. Расхождение заметно как «мигание» при переходе.
    expect(spinner).toContain('props.size ?? 56')
    expect(spinner).toContain('Math.max(3, Math.round(size / 14))}px')
    expect(spinner).toContain('animation: brand-spinner-rotate 0.9s linear infinite')

    expect(html).toContain('width: 56px')
    expect(html).toContain('border: 4px solid')
    expect(html).toContain('animation: boot-spin 0.9s linear infinite')
  })

  it('цвет кольца — акцент человека, фон — фон темы', () => {
    // `--ms-accent` ставит /theme-boot.js до первого кадра, поэтому кружок
    // получается того же цвета, что и в приложении; тёмные темы иначе дали бы
    // светлое пятно на весь экран.
    expect(html).toContain('var(--ms-accent, #2ea25e)')
    expect(html).toContain("html[data-theme='dark'] #boot")
    expect(html).toContain("html[data-theme='amoled'] #boot")
  })

  it('«уменьшить движение» замедляет кружок, а не убирает его', () => {
    // Если анимацию выключить совсем, непонятно, что приложение вообще грузится
    // (то же решение, что в BrandSpinner).
    expect(html).toContain('prefers-reduced-motion: reduce')
    expect(html).toContain('animation-duration: 2.4s')
  })
})
