import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Приём файлов, брошенных в окно приложения (как в десктопных мессенджерах).
 *
 * Слушатели висят на `window`, а не на отдельном блоке: файл можно бросить в
 * любое место — на ленту сообщений, список чатов, шапку. Отдельной зоны у
 * полосы ввода при этом не нужно: обработчик один, и подсказка одна.
 *
 * ПОЧЕМУ обязателен `preventDefault()`: бросок файла в окно — это навигация
 * браузера. Без подавления он открывает файл вместо чата, то есть приложение
 * исчезает вместе с неотправленным сообщением. Гасим и `dragover` — иначе
 * браузер не считает окно допустимой целью и `drop` не приходит вовсе.
 *
 * Перетаскивание текста (выделение из другого окна) не трогаем: у него в
 * `dataTransfer.types` нет `Files`, и бросок текста в поле ввода должен работать
 * как обычно.
 */
export interface FileDropOptions {
  /** Что делать с брошенными файлами (их может быть несколько сразу). */
  onFiles: (files: File[]) => void
}

export interface FileDrop {
  /** Над окном сейчас тянут файл(ы) — показываем подсказку. */
  active: Ref<boolean>
}

export function useFileDrop({ onFiles }: FileDropOptions): FileDrop {
  const active = ref(false)
  // Счётчик вложенных dragenter/dragleave: при переходе курсора между дочерними
  // элементами браузер шлёт пару событий, и подсветка без счётчика мигает.
  let depth = 0

  const isFileDrag = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const reset = () => {
    depth = 0
    active.value = false
  }

  const onDragEnter = (event: DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    depth += 1
    active.value = true
  }

  // `dragover` приходит постоянно, пока курсор над окном, поэтому счётчик здесь
  // не трогаем: иначе подсветка «залипнет» и не снимется одним dragleave.
  const onDragOver = (event: DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    active.value = true
  }

  // Тип перетаскивания проверять НЕЛЬЗЯ: подсветку снимает именно то событие,
  // которое пришло; лишний dragleave текстового перетаскивания ничего не ломает
  // (счётчик не уходит ниже нуля, потому что такие события его не поднимали).
  const onDragLeave = () => {
    depth = Math.max(0, depth - 1)
    if (depth === 0) active.value = false
  }

  const onDrop = (event: DragEvent) => {
    const fileDrag = isFileDrag(event)
    reset()
    if (!fileDrag) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) onFiles(files)
  }

  onMounted(() => {
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('dragenter', onDragEnter)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('drop', onDrop)
  })

  return { active }
}
