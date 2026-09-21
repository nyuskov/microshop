<template>
  <template v-if="file">
    <!-- Альбом: несколько картинок одной отправки — сеткой, как в мессенджерах.
         Плитка знает своё сообщение и открывает лайтбокс именно на нём. -->
    <div
      v-if="albumTiles.length > 1"
      class="album-grid"
      :class="[`cols-${albumColumns}`, { wide: props.wide }]"
    >
      <button
        v-for="tile in albumTiles"
        :key="tile.message.id"
        type="button"
        class="album-tile"
        :title="`Открыть изображение «${tile.name}»`"
        @click.stop="emit('open-image', tile.message)"
      >
        <img
          v-if="tile.url && !tile.broken"
          :src="tile.url"
          :alt="tile.name"
          class="album-image"
          loading="lazy"
          decoding="async"
          @error="markBroken(tile.message.id)"
        />
        <span v-else class="album-locked">
          <q-icon :name="icon(tile.url ? 'warning' : 'lock')" size="18px" />
        </span>
      </button>
    </div>
    <!-- Одноразовое медиа: содержимое НЕ грузим, пока не нажмут.
         Сервер отдаёт такой файл ровно один раз, и любое превью сожгло бы
         вложение ещё до просмотра. -->
    <button
      v-else-if="viewOnce"
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
      :class="{ sticker: props.sticker, wide: props.wide }"
      type="button"
      :title="props.sticker ? 'Открыть набор стикеров' : `Открыть изображение «${file.name}»`"
      @click.stop="openAttachment()"
    >
      <img
        v-if="fileUrl && !imageBroken"
        :src="fileUrl"
        :alt="file.name"
        class="attachment-image"
        :class="{ wide: props.wide }"
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
        :class="{ wide: props.wide }"
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
  sticker?: boolean /**
   * Все вложения альбома (включая это сообщение): пачку рисуем одной сеткой
   * (см. `utils/albums.ts`). Пусто или одно — обычное одиночное вложение.
   */
  album?: Message[]
  /**
   * Пост канала: строка занимает всю ширину ленты, поэтому и вложение растёт
   * вместе с ней (в чате картинка ограничена 300px, а видео — 320px: там рядом
   * ещё пузырь собеседника). Предел по ВЫСОТЕ остаётся — вертикальное фото на
   * всю ширину растянуло бы один пост на несколько экранов.
   */
  wide?: boolean
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
  /**
   * Картинка открывается в лайтбоксе. Для альбома приходит КОНКРЕТНОЕ вложение
   * (человек нажал на плитку, а она другая, чем головное сообщение); пусто —
   * значит открываем вложение самой строки.
   */
  (e: 'open-image', message?: Message): void
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

// ---------- Альбом ----------

/** Вложения альбома: с одним сообщением альбом не нужен — это обычная картинка. */
const albumItems = computed<Message[]>(() =>
  props.album && props.album.length > 1 ? props.album : []
)

/** Раскладка сетки: два фото — в два столбца, три и больше — в три. */
const albumColumns = computed<number>(() => (albumItems.value.length === 2 ? 2 : 3))

/** id картинок альбома, которые не открылись: вместо пустоты — значок. */
const brokenAlbumImages = ref<Set<number>>(new Set())
const markBroken = (messageId: number): void => {
  brokenAlbumImages.value = new Set([...brokenAlbumImages.value, messageId])
}

interface AlbumTile {
  message: Message
  name: string
  url: string
  broken: boolean
}

/**
 * Плитки альбома.
 *
 * Расшифровка у каждой своя: в E2EE-чате файлы шифруются ПО ОТДЕЛЬНОСТИ, и
 * готовность одного вложения ничего не говорит про соседей, поэтому в ленте
 * плитка сначала показывает замок.
 */
const albumTiles = computed<AlbumTile[]>(() =>
  albumItems.value.map((message) => {
    const attachment = effectiveFile(message)
    const local = decryptedMediaFor(message, { enabled: () => props.rowVisible })
    const url = local
      ? local.status === 'ready'
        ? local.url
        : ''
      : attachment
        ? mediaAbsolute(attachment.url)
        : ''
    return {
      message,
      name: attachment?.name ?? 'Изображение',
      url,
      broken: brokenAlbumImages.value.has(message.id)
    }
  })
)
</script>

<style scoped>
/* Вложения */
.attachment {
  display: block;
  margin-bottom: 4px;
  text-decoration: none;
}

/* Альбом: несколько картинок одной отправки. Ширина — как у одиночной
   картинки, плитки квадратные: сетка не «разъезжается» от числа файлов. */
.album-grid {
  display: grid;
  gap: 2px;
  width: min(300px, calc(100vw - 60px));
  /* Ступень из шкалы: у одиночной картинки исторически 8px, ближайшая ступень —
     xs (6px); разница в углах незаметна, а литералы геометрии запрещены. */
  border-radius: var(--ms-radius-xs);
  overflow: hidden;
  margin-bottom: 4px;
}

.album-grid.cols-2 {
  grid-template-columns: repeat(2, 1fr);
}

.album-grid.cols-3 {
  grid-template-columns: repeat(3, 1fr);
}

.album-tile {
  position: relative;
  padding: 0;
  border: none;
  background: var(--ms-surface-2);
  cursor: zoom-in;
  aspect-ratio: 1 / 1;
  overflow: hidden;
}

.album-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Зашифрованная или не открывшаяся плитка: значок вместо пустого места. */
.album-locked {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--ms-muted);
}

/* Канал: пост занимает всю ширину, поэтому и вложение растёт вместе с ним.
   Правила стоят ДО правила стикера: у стикера своя специфичность выше
   (`.attachment-image-btn.sticker .attachment-image`), поэтому квадратик 160px
   в канале остаётся квадратиком — растягивать «эмоцию» во всю ширину незачем. */
.attachment-image.wide,
.attachment-video.wide {
  max-width: 100%;
  /* Высота ограничена: вертикальное фото во всю ширину заняло бы весь экран. */
  max-height: min(70vh, 520px);
}

.album-grid.wide {
  width: 100%;
}

/* Кнопка-обёртка тоже во всю ширину: у неё `width: auto` — это «по содержимому»,
   и процентный `max-width` у картинки разрешался в её же ширину (замер: картинка
   получала 0px). С заданной шириной кнопки процент считается от пузыря. */
.attachment-image-btn.wide {
  width: 100%;
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
