<template>
  <q-dialog :model-value="true" maximized @update:model-value="emit('close')">
    <div class="vo">
      <img v-if="kind === 'image'" :src="url" class="vo-media" :alt="name" />
      <video
        v-else-if="kind === 'video'"
        :src="url"
        class="vo-media"
        controls
        autoplay
        playsinline
      ></video>
      <div v-else class="vo-file">
        <q-icon :name="icon('attach_file')" size="22px" aria-hidden="true" />
        <span>{{ name }}</span>
      </div>

      <div class="vo-bar">
        <span class="vo-note">
          Одноразовое медиа: после закрытия оно исчезнет у всех участников. Скриншот или запись
          экрана запретить нельзя — об этом честно предупреждаем.
        </span>
        <button class="vo-close" type="button" @click="emit('close')">Закрыть</button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Просмотр одноразового вложения.
 *
 * Отдельное окно, а не общий лайтбокс: там листание по всей ленте и кнопка
 * «Скачать» — с «сгорающим» медиа и то и другое недопустимо. Ссылка на кадр —
 * одноразовая blob-ссылка, её освобождает вызывающий при закрытии.
 */
import { icon } from '@/utils/icons'

defineProps<{
  /** Ссылка на содержимое (blob: — своя копия в памяти вкладки). */
  url: string
  /** Что показываем: картинку, видео или просто имя файла. */
  kind: 'image' | 'video' | 'file'
  /** Имя вложения — показывается, если содержимое не удалось распознать. */
  name: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<style scoped>
.vo {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ms-space-3);
  width: 100%;
  height: 100%;
  padding: var(--ms-space-4);
  background: var(--ms-backdrop);
}

.vo-media {
  max-width: 100%;
  max-height: calc(100% - 90px);
  border-radius: var(--ms-radius);
  object-fit: contain;
}

.vo-file {
  display: inline-flex;
  align-items: center;
  gap: var(--ms-space-2);
  padding: var(--ms-space-3) var(--ms-space-4);
  border-radius: var(--ms-radius);
  background: var(--ms-surface);
  color: var(--ms-text);
  font-size: var(--ms-fs-base);
}

.vo-bar {
  display: flex;
  align-items: center;
  gap: var(--ms-space-3);
  flex-wrap: wrap;
  justify-content: center;
}

.vo-note {
  max-width: 520px;
  color: var(--ms-text);
  font-size: var(--ms-fs-xs);
  text-align: center;
}

.vo-close {
  border: none;
  border-radius: var(--ms-radius-sm);
  padding: 8px 16px;
  background: var(--ms-surface);
  color: var(--ms-text);
  font-family: var(--ms-font), sans-serif;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  cursor: pointer;
}
</style>
