/**
 * Где поставить панель формата при выделении текста.
 *
 * Панель должна вставать РЯДОМ с выделением (владелец, 29.09.2026: «в веб версии
 * меню слетает куда-то в центр, а не рядом с выделением»). Центр поля для этого
 * не годится: в вебе поле во всю ширину панели, и «по центру поля» — это центр
 * мессенджера, далеко от текста, который человек выделил.
 *
 * Браузер не отдаёт координаты выделения внутри `<textarea>`, поэтому измеряем
 * «зеркалом»: тот же размер, шрифт и отступы, но обычный блок — вставляем в него
 * текст до каретки и читаем положение невидимой метки. Приём известный
 * (textarea-caret-position), но здесь он намного короче: нужна только одна точка
 * на строке выделения, а не прямоугольник.
 */

/** Точка каретки в координатах поля: отступ слева, сверху и высота строки. */
export interface CaretBox {
  left: number
  /** Уже за вычетом прокрутки поля: панель встаёт к ВИДИМОЙ строке. */
  top: number
  /** Высота строки: по ней панель встаёт под выделение, когда сверху нет места. */
  height: number
}

/** Размер самой панели: измеряется после отрисовки (зависит от длины подписей). */
export interface PanelSize {
  width: number
  height: number
}

/**
 * С какой стороны от выделения встала панель.
 *
 * `above-selection` — над строкой выделения (компьютер: сверху лента, снизу клавиатура).
 * `below-selection` — под строкой выделения (телефон: там места нет под системной панелью).
 * `above-field` — выше самого поля, с запасом на системную панель (телефон + короткое поле).
 */
export type MenuSide = 'above-selection' | 'below-selection' | 'above-field'

/** Куда встала панель: точка привязки и сторона от выделения. */
export interface MenuAnchor {
  /** Отступ слева (центр панели встанет на эту точку). */
  left: number
  /** Отступ сверху — уже с учётом стороны (см. `side`). */
  top: number
  side: MenuSide
}

/**
 * Координаты поля, от которых считается место.
 *
 * `top` — отступ поля от ВЕРХА ОКНА (`getBoundingClientRect().top`), а не от верха
 * панели: панель формата сама всплывает поверх ленты, и над ней места сколько
 * угодно — важно, чтобы она не уехала за верхний или нижний край окна.
 * `height` — высота самого поля (сколько в нём есть места под выделением).
 */
export interface FieldBox {
  width: number
  top: number
  height: number
}

/**
 * Запас над полем на телефоне — на системную панель выделения.
 *
 * «Копировать / Вырезать / Вставить» браузер (или WebView) рисует САМ, прямо над
 * выделенным текстом, высотой ~48 px. Панель формата вставала ровно под ней и была
 * недоступна — владелец: «при выделении текста системная панель в мобилке мешает
 * нашей панели» (29.09.2026). Обойти её можно только разведением по вертикали.
 */
export const SYSTEM_SELECTION_BAR_HEIGHT = 56

/**
 * Что копируем в «зеркало» из самого поля.
 *
 * Переносят текст три вещи: ширина, шрифт и внутренние отступы; рамку копируем,
 * чтобы `box-sizing: border-box` сошёлся по ширине.
 */
const MIRROR_PROPS = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'letter-spacing',
  'line-height',
  'text-indent',
  'text-transform',
  'word-spacing',
  'tab-size'
]

/** Индекс в границах текста: выделение могло «уехать» после перерисовки. */
const clampIndex = (index: number, length: number): number =>
  Math.max(0, Math.min(Math.trunc(index), length))

/**
 * Где в поле стоит каретка (или начало выделения).
 *
 * Координаты — от левого верхнего угла поля: у поля ввода рамки нет
 * (`border: none`), поэтому они же и координаты внутри `.editor-slot`, от
 * которого позиционируется панель.
 */
export function caretBox(el: HTMLTextAreaElement, index: number): CaretBox {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const prop of MIRROR_PROPS) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop))
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  // Ширина — вся ширина поля: строки должны переноситься так же, как в нём.
  mirror.style.boxSizing = 'border-box'
  mirror.style.width = `${el.offsetWidth}px`
  mirror.style.height = 'auto'
  // Поле ввода переносит текст сам (горизонтальной прокрутки у него нет),
  // поэтому и длинные слова «зеркало» обязано ломать.
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'

  mirror.textContent = el.value.slice(0, clampIndex(index, el.value.length))
  const marker = document.createElement('span')
  // Невидимый символ, а не пустая строка: у пустого `<span>` нечего мерить.
  marker.textContent = '\u200b'
  mirror.append(marker)
  document.body.append(mirror)

  const left = marker.offsetLeft
  const top = marker.offsetTop - el.scrollTop
  const height = Number.parseFloat(style.lineHeight) || marker.offsetHeight || 0
  mirror.remove()

  return { left, top, height }
}

/**
 * Куда панель встанет: рядом с выделением, не под системной панелью и не за краем окна.
 *
 * На компьютере (`touch` = false) — НАД выделением: лента выше, там панель ничего не
 * закрывает, а снизу её съедала бы клавиатура (владелец, «оно снизу, а надо сверху»).
 * Сверху места хватает, пока панель не упрётся в верх ОКНА — только тогда она уходит
 * под строку выделения.
 *
 * На телефоне (`touch` = true) над выделением висит СИСТЕМНАЯ панель («Копировать»),
 * поэтому там своё правило: под строку выделения, если внутри поля есть место, иначе
 * выше поля с запасом `SYSTEM_SELECTION_BAR_HEIGHT` — под системной панелью наша не
 * встанет ни в одном из двух случаев.
 *
 * `left` — центр панели: её поднимают по `translate(-50%)`, поэтому в край поля
 * упирается половина ширины. Если панель шире поля (узкий телефон), она просто
 * встаёт по центру.
 */
export function menuAnchor(
  box: CaretBox,
  panel: PanelSize,
  field: FieldBox,
  gap = 8,
  touch = false
): MenuAnchor {
  const half = panel.width / 2
  const left = Math.min(Math.max(box.left, half), Math.max(half, field.width - half))

  if (touch) {
    // Место под выделением считаем ВНУТРИ поля: ниже его края панель уехала бы
    // под клавиатуру (в свёрнутом виде поле стоит в самом низу экрана).
    const roomBelow = box.top + box.height + gap + panel.height <= field.height
    if (roomBelow) return { left, top: box.top + box.height, side: 'below-selection' }
    return { left, top: 0, side: 'above-field' }
  }

  const above = field.top + box.top - gap >= panel.height
  return {
    left,
    top: above ? box.top : box.top + box.height,
    side: above ? 'above-selection' : 'below-selection'
  }
}
