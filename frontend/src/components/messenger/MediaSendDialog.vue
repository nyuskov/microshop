<template>
  <div class="ms-overlay media-send-overlay" @mousedown.self="emit('close')">
    <div
      ref="trapContainer"
      class="ms-overlay-card media-send-card"
      role="dialog"
      aria-modal="true"
      aria-label="Отправка вложения"
      tabindex="-1"
    >
      <div class="ms-overlay-head">
        <h2 class="ms-overlay-title">{{ title }}</h2>
        <button class="icon-btn" type="button" title="Закрыть" @click="emit('close')">
          <q-icon :name="icon('close')" size="20px" />
        </button>
      </div>

      <div class="ms-overlay-body">
        <!-- Ответ остаётся видимым: подпись и цитата уедут одним сообщением. -->
        <div v-if="replyTo" class="send-reply">
          <q-icon :name="icon('reply')" size="16px" aria-hidden="true" />
          <span class="send-reply-name">{{ replyTo.name }}</span>
          <span class="send-reply-text">{{ replyTo.text }}</span>
        </div>

        <!-- Превью — как в Телеграме: видно, что именно уходит, ещё до отправки. -->
        <div class="send-grid" :class="`cols-${columns}`">
          <div v-for="item in items" :key="item.key" class="send-item">
            <img
              v-if="item.preview"
              class="send-thumb"
              :src="item.preview"
              :alt="item.name"
              loading="lazy"
              decoding="async"
            />
            <span v-else class="send-file">
              <q-icon :name="icon(item.iconName)" size="22px" aria-hidden="true" />
              <span class="send-file-name">{{ item.name }}</span>
              <span class="send-file-size">{{ formatBytes(item.size) }}</span>
            </span>
          </div>
        </div>

        <p v-if="viewOnce" class="send-note">
          <q-icon :name="icon('visibility')" size="16px" aria-hidden="true" />
          Откроется один раз и сгорит после просмотра
        </p>

        <!-- Подпись. Поле в фокусе сразу: чаще всего вложение прикрепляют,
             чтобы что-то к нему написать (владелец: «отсылать фото с
             комментарием, как в Телеграме»). -->
        <textarea
          ref="captionRef"
          v-model="caption"
          class="send-caption"
          rows="2"
          maxlength="4000"
          placeholder="Добавьте подпись…"
          aria-label="Подпись к вложению"
          @keydown.esc.prevent="emit('close')"
          @keydown.ctrl.enter.prevent="submit"
          @keydown.meta.enter.prevent="submit"
        ></textarea>
      </div>

      <div class="ms-overlay-foot media-send-foot">
        <button class="send-primary" type="button" @click="submit">
          <q-icon :name="icon('send')" size="18px" aria-hidden="true" />
          <span>Отправить</span>
        </button>
        <button class="send-ghost" type="button" @click="emit('close')">Отмена</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Окно отправки вложения: превью, подпись и «Отправить» — как в Телеграме.
 *
 * Зачем оно нужно: раньше подпись получалась только у того файла, который
 * отправили первым, и только если текст был набран ДО выбора файла (он уходил
 * из поля ввода). То есть «прикрепил фото, потом написал комментарий» было
 * невозможно — а это и есть обычный порядок действий. Теперь файлы сначала
 * попадают сюда, здесь к ним пишется подпись, и только потом они уходят.
 *
 * Окно ничего не отправляет само: оно отдаёт подпись родителю (`send`), а
 * отправку и прогресс показывает лента — теми же временными пузырями, что и
 * раньше.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { icon } from '@/utils/icons'
import { formatBytes, pluralRu } from '@/utils/format'
import { fileIcon } from '@/utils/media'
import { useFocusTrap } from '@/composables/useFocusTrap'

// Оверлей самодельный (не q-dialog) — фокус держим сами, иначе Tab уходит в чат.
const { container: trapContainer } = useFocusTrap()

const props = defineProps<{
  /** Файлы, выбранные одним действием (пачка картинок уйдёт альбомом). */
  files: File[]
  /** Подпись, уже набранная в поле ввода (её можно поправить). */
  caption?: string
  /** «Посмотреть один раз»: предупредим, что медиа сгорит. */
  viewOnce?: boolean
  /** Ответ на сообщение — показываем цитату, к которой уйдёт вложение. */
  replyTo?: { name: string; text: string } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Готово к отправке: подпись (может быть пустой). */
  (e: 'send', caption: string): void
}>()

const caption = ref<string>(props.caption ?? '')
const captionRef = ref<HTMLTextAreaElement | null>(null)

interface PreviewItem {
  key: string
  name: string
  size: number
  preview: string
  iconName: string
}

/**
 * Превью файлов.
 *
 * Ссылки на картинки создаём один раз и освобождаем при закрытии окна: иначе
 * каждый выбранный файл оставался бы висеть в памяти вкладки до перезагрузки.
 */
const objectUrls: string[] = []
const previews: string[] = []

/** Превью-ссылка на картинку: считаем по индексу, чтобы не создавать заново. */
const previewUrlOf = (index: number, file: File): string => {
  const cached = previews[index]
  if (cached) return cached
  const url = URL.createObjectURL(file)
  previews[index] = url
  objectUrls.push(url)
  return url
}

const items = computed<PreviewItem[]>(() =>
  props.files.map((file, index) => {
    const isImage = file.type.startsWith('image/')
    return {
      key: `${index}-${file.name}`,
      name: file.name || 'Файл',
      size: file.size,
      preview: isImage ? previewUrlOf(index, file) : '',
      iconName: fileIcon({ name: file.name, url: '', mime: file.type, size: file.size })
    }
  })
)

/** Раскладка превью: одно — целиком, два — в ряд, больше — сетка по три. */
const columns = computed<number>(() => {
  const count = props.files.length
  if (count === 1) return 1
  return count === 2 ? 2 : 3
})

const title = computed<string>(() =>
  props.files.length === 1
    ? 'Отправить вложение'
    : `Отправить ${props.files.length} ${pluralRu(props.files.length, 'файл', 'файла', 'файлов')}`
)

const submit = (): void => {
  emit('send', caption.value.trim())
}

onMounted(() => {
  void nextTick(() => {
    const field = captionRef.value
    if (!field) return
    field.focus()
    // Курсор в конец: подпись из поля ввода дописывают, а не переписывают.
    field.setSelectionRange(field.value.length, field.value.length)
  })
})

onBeforeUnmount(() => {
  for (const url of objectUrls) URL.revokeObjectURL(url)
})
</script>

<style scoped>
.media-send-overlay {
  z-index: 3200;
}

.media-send-card {
  width: min(var(--ms-dialog-w-sm), calc(100vw - 32px));
}

.send-reply {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font-size: var(--ms-fs-sm);
}

.send-reply-name {
  color: var(--ms-text-strong);
  font-weight: 600;
}

.send-reply-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.send-grid {
  display: grid;
  gap: 4px;
}

.send-grid.cols-1 {
  grid-template-columns: 1fr;
}

.send-grid.cols-2 {
  grid-template-columns: repeat(2, 1fr);
}

.send-grid.cols-3 {
  grid-template-columns: repeat(3, 1fr);
}

.send-item {
  overflow: hidden;
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
}

.send-thumb {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}

.send-grid.cols-2 .send-thumb,
.send-grid.cols-3 .send-thumb {
  aspect-ratio: 1 / 1;
}

/* Не картинка (документ, архив): строка-карточка на всю ширину, а не квадрат. */
.send-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--ms-text-strong);
  font-size: var(--ms-fs-sm);
  grid-column: 1 / -1;
}

.send-file-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.send-file-size {
  margin-left: auto;
  color: var(--ms-muted);
}

.send-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  color: var(--ms-muted);
  font-size: var(--ms-fs-xs);
}

.send-caption {
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font-family: var(--ms-font);
  font-size: var(--ms-fs-md);
  line-height: 1.35;
  resize: none;
  min-height: 44px;
}

.send-caption:focus {
  outline: none;
  border-color: var(--ms-accent);
}

.media-send-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.send-primary,
.send-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  border-radius: var(--ms-radius-pill);
  font-family: var(--ms-font);
  font-size: var(--ms-fs-md);
  cursor: pointer;
}

.send-primary {
  background: var(--ms-accent);
  color: var(--ms-on-accent);
}

.send-ghost {
  background: transparent;
  color: var(--ms-muted);
}
</style>
