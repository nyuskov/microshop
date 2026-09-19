<template>
  <template v-if="file">
    <!-- Одноразовое медиа: содержимое НЕ грузим, пока не нажмут.
         Сервер отдаёт такой файл ровно один раз, и любое превью сожгло бы
         вложение ещё до просмотра. -->
    <button
      v-if="viewOnce"
      type="button"
      class="attachment attachment-view-once"
      :class="{ opened: viewOnceOpened }"
      :disabled="viewOnceOpened"
      :title="viewOnceOpened ? 'Вложение просмотрено' : 'Открыть (сгорит после просмотра)'"
      @click.stop="emit('open-view-once')"
    >
      <q-icon :name="icon(viewOnceOpened ? 'done_all' : 'visibility')" size="22px" />
      <span class="attachment-view-once-text">
        <span class="attachment-name">
          {{ viewOnceOpened ? 'Просмотрено' : viewOnceLabel }}
        </span>
        <span class="attachment-meta">
          {{ viewOnceOpened ? 'Медиа больше недоступно' : 'Сгорит после открытия' }}
        </span>
      </span>
    </button>
    <button
      v-else-if="isImageFile(file)"
      class="attachment attachment-image-btn"
      :class="{ sticker: props.sticker }"
      type="button"
      :title="props.sticker ? 'Открыть набор стикеров' : `Открыть изображение «${file.name}»`"
      @click.stop="openAttachment()"
    >
      <img
        v-if="fileUrl && !imageBroken"
        :src="fileUrl"
        :alt="file.name"
        class="attachment-image"
        loading="lazy"
        decoding="async"
        @error="imageBroken = true"
      />
      <span v-else class="attachment-locked">
        <q-icon :name="icon(imageBroken ? 'warning' : 'lock')" size="20px" />
        <span>{{ imageBroken ? brokenLabel : lockedLabel }}</span>
      </span>
    </button>
    <template v-else-if="fileUrl">
      <RoundVideoMessage
        v-if="isRecordedVideoMessage(file)"
        :message-id="message.id"
        :src="fileUrl"
        :name="file.name"
        :size="file.size"
      />
      <video
        v-else-if="isVideoFile(file)"
        class="attachment-video"
        :src="fileUrl"
        controls
        preload="metadata"
        @click.stop
      ></video>
      <AudioMessage
        v-else-if="isAudioFile(file)"
        :message-id="message.id"
        :src="fileUrl"
        :name="file.name"
        :size="file.size"
      />
      <a
        v-else
        class="attachment"
        :href="fileUrl"
        :download="file.name"
        target="_blank"
        rel="noopener"
      >
        <span class="attachment-card">
          <q-icon :name="icon(fileIcon(file))" size="26px" />
          <span class="attachment-info">
            <span class="attachment-name">{{ file.name }}</span>
            <span class="attachment-meta">{{ formatBytes(file.size) }}</span>
          </span>
        </span>
      </a>
    </template>
    <!-- Зашифрованный файл: пока не расшифрован, вместо содержимого — замок. -->
    <span v-else class="attachment attachment-locked">
      <q-icon :name="icon('lock')" size="20px" />
      <span>{{ lockedLabel }}</span>
    </span>
  </template>
</template>

<script setup lang="ts">
/**
 * Вложение сообщения: картинка, кружок, видео, аудио или файл-карточка.
 *
 * Расшифровка E2EE-файлов живёт здесь же и запускается только когда строка уже
 * доходила до экрана (`rowVisible`): иначе на открытие чата скачивались бы
 * вложения всей истории (см. `useDecryptedMedia`). Пока расшифровки нет,
 * вместо шифротекста показываем «замок».
 */
import { computed, ref, watch } from 'vue'
import type { Message } from '@/types'
import { mediaUrl } from '@/config'
import { formatBytes } from '@/utils/format'
import { icon } from '@/utils/icons'
import {
  effectiveFile,
  fileIcon,
  isAudioFile,
  isImageFile,
  isRecordedVideoMessage,
  isVideoFile
} from '@/utils/media'
import { decryptedMediaFor } from '@/composables/useDecryptedMedia'
import AudioMessage from '@/components/media/AudioMessage.vue'
import RoundVideoMessage from '@/components/media/RoundVideoMessage.vue'

const props = defineProps<{
  /** Сообщение, вложение которого показываем. */
  message: Message
  /** Строка уже доходила до экрана — только тогда расшифровываем содержимое. */
  rowVisible: boolean
  /**
   * Картинка-стикер (`kind='sticker'`): показываем крупно и без рамки — в ленте
   * это не «вложение с превью», а сам стикер.
   */
  sticker?: boolean
}>()

/**
 * Корень компонента — фрагмент (`<template v-if=«file»>` с несколькими ветками),
 * поэтому наследовать атрибуты некуда: без этого Vue в dev-режиме предупреждает
 * «Extraneous non-emits event listeners (openViewOnce) … renders fragment root»
 * на каждом вложении. Настоящих атрибутов для корня здесь нет — все события
 * объявлены ниже (`defineEmits`).
 */
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{
  /** Обычная картинка: лайтбокс. */
  (e: 'open-image'): void
  /** Стикер: окно его набора (как в Телеграме — по тапу видно весь набор). */
  (e: 'open-sticker'): void
  (e: 'open-view-once'): void
}>()

/**
 * Тап по картинке: стикер открывает свой набор (как в Телеграме), обычная
 * картинка — просмотр. Что именно показать вместо набора (метки нет) — решает
 * родитель: здесь про паки ничего не знают.
 */
const openAttachment = (): void => {
  if (props.sticker) emit('open-sticker')
  else emit('open-image')
}

/** Одноразовое вложение и его состояние (открыто — файла больше нет). */
const viewOnce = computed(() => props.message.view_once === true)
const viewOnceOpened = computed(() => props.message.view_once_opened === true)
const viewOnceLabel = computed(() =>
  (props.message.file?.mime ?? '').startsWith('video/') ? 'Одноразовое видео' : 'Одноразовое фото'
)

const mediaAbsolute = (path: string): string => mediaUrl(path)

const file = computed(() => effectiveFile(props.message))

const decrypted = computed(() =>
  // Расшифровку начинаем, когда строка дошла до экрана: иначе на открытие чата
  // скачивались бы вложения всей истории.
  decryptedMediaFor(props.message, { enabled: () => props.rowVisible })
)

/**
 * URL вложения: у зашифрованного файла — расшифрованная blob-ссылка (пока её
 * нет, показываем «замок», а не шифротекст), у обычного — прямая ссылка.
 */
const fileUrl = computed<string>(() => {
  const attachment = file.value
  if (!attachment) return ''
  const local = decrypted.value
  if (local) return local.status === 'ready' ? local.url : ''
  return mediaAbsolute(attachment.url)
})

const lockedLabel = computed<string>(() =>
  decrypted.value?.status === 'failed' ? '🔒 Не удалось расшифровать' : '🔒 Расшифровываем…'
)

/**
 * Файл не открылся (его нет на сервере или ссылка битая).
 *
 * Показываем надпись вместо пустого места: пустая картинка в пузыре читалась как
 * «тёмное окно» и не говорила, что случилось. Сбрасываем признак при смене
 * ссылки — если придёт расшифрованная копия, попробуем показать её.
 */
const imageBroken = ref(false)
watch(fileUrl, () => {
  imageBroken.value = false
})

const brokenLabel = computed<string>(() =>
  props.sticker ? 'Стикер недоступен' : 'Изображение недоступно'
)
</script>

<style scoped>
/* Вложения */
.attachment {
  display: block;
  margin-bottom: 4px;
  text-decoration: none;
}

.attachment-image-btn {
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}

.attachment-image {
  /* На узком экране (320–360px) запасной предел 300px всё ещё больше ленты —
     берём минимум из него и ширины окна, иначе лента обрежет картинку. */
  max-width: min(300px, calc(100vw - 60px));
  max-height: 260px;
  border-radius: 8px;
  display: block;
}

/* Стикер: квадрат поменьше и без скругления фона — это не «превью фото», а
   картинка-эмоция, поэтому она не должна выглядеть как вложенный снимок. */
.attachment-image-btn.sticker .attachment-image {
  max-width: 160px;
  max-height: 160px;
  border-radius: 0;
}

.attachment-video {
  max-width: min(320px, calc(100vw - 60px));
  max-height: 300px;
  border-radius: 8px;
  display: block;
  margin-bottom: 4px;
}

.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--ms-surface-2);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--ms-text-strong);
}

.attachment-card i {
  font-size: 1.6rem;
  color: var(--ms-danger);
}

/* Зашифрованное вложение, которое ещё не расшифровано (или не читается) */
/* Плашка одноразового вложения: содержимого не видно, пока не нажмут —
   поэтому это не превью, а карточка «открыть/просмотрено». */
.attachment-view-once {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--ms-accent-soft);
  color: var(--ms-text);
  cursor: pointer;
  text-align: left;
}

.attachment-view-once.opened {
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  cursor: default;
}

.attachment-view-once-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.attachment-view-once .attachment-meta {
  color: var(--ms-muted);
  font-size: var(--ms-fs-xs);
}

.attachment-locked {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--ms-surface-2);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--ms-muted);
  font-size: 13.5px;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ms-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.attachment-meta {
  font-size: 12px;
  color: var(--ms-muted-2);
}
</style>
