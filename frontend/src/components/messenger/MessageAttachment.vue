<template>
  <template v-if="file">
    <button
      v-if="isImageFile(file)"
      class="attachment attachment-image-btn"
      :class="{ sticker: props.sticker }"
      type="button"
      :title="props.sticker ? 'Открыть стикер' : `Открыть изображение «${file.name}»`"
      @click.stop="emit('open-image')"
    >
      <img
        v-if="fileUrl"
        :src="fileUrl"
        :alt="file.name"
        class="attachment-image"
        loading="lazy"
        decoding="async"
      />
      <span v-else class="attachment-locked">
        <q-icon :name="icon('lock')" size="20px" />
        <span>{{ lockedLabel }}</span>
      </span>
    </button>
    <template v-else-if="fileUrl">
      <RoundVideoMessage
        v-if="isRecordedVideoMessage(file)"
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
import { computed } from 'vue'
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

const emit = defineEmits<{ (e: 'open-image'): void }>()

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
