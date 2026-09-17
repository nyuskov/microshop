<template>
  <div class="input-area">
    <div v-if="sendError" class="inline-error">{{ sendError }}</div>

    <!-- Редактирование сообщения -->
    <div v-if="editingMessage" class="reply-bar mode-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">Редактирование</span>
        <span class="reply-bar-text">{{ editingMessage.text }}</span>
      </div>
      <button class="icon-btn" title="Отмена" @click="emit('cancel-edit')">
        <q-icon :name="icon('close')" size="20px" />
      </button>
    </div>

    <!-- Цитата ответа -->
    <div v-if="replyTarget" class="reply-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">{{ replyBarName }}</span>
        <span class="reply-bar-text">{{ messageSnippet(replyTarget) }}</span>
      </div>
      <button class="icon-btn" title="Отменить ответ" @click="emit('clear-reply')">
        <q-icon :name="icon('close')" size="20px" />
      </button>
    </div>

    <VoiceRecorderBar
      v-if="voiceRecOpen"
      @cancel="emit('voice-cancel')"
      @send="(payload) => emit('voice-send', payload)"
    />
    <div v-else class="input-row">
      <button
        v-if="!hasText"
        class="round-btn"
        title="Прикрепить файл"
        @click="attachInput?.click()"
      >
        <q-icon :name="icon('attach_file')" size="20px" />
      </button>
      <input
        ref="attachInput"
        class="hidden-file"
        type="file"
        aria-label="Прикрепить файл"
        @change="onFileSelected"
      />
      <textarea
        ref="textInputRef"
        v-model="newMessage"
        class="text-input"
        rows="1"
        placeholder="Сообщение"
        aria-label="Сообщение"
        @keydown="onTextKeydown"
        @input="onTextInput"
        @click="updateMentions"
        @paste="onTextPaste"
      ></textarea>
      <button
        class="round-btn"
        :class="{ active: extrasPanel !== 'none' }"
        title="Эмодзи и GIF"
        @click="emit('toggle-extras')"
      >
        <q-icon :name="icon('sentiment_satisfied_alt')" size="20px" />
      </button>
      <span v-if="!hasText" class="mic-wrap">
        <button
          class="round-btn mic-hold-btn"
          :class="{
            holding: micHolding,
            'mode-video': recordMode === 'video'
          }"
          :title="
            recordMode === 'video'
              ? 'Видеосообщение (нажмите). Удерживайте 2 секунды — голосовое'
              : 'Голосовое сообщение (нажмите). Удерживайте 2 секунды — видеосообщение'
          "
          :aria-label="
            recordMode === 'video'
              ? 'Записать видеосообщение. Удерживайте 2 секунды для голосового'
              : 'Записать голосовое сообщение. Удерживайте 2 секунды для видеосообщения'
          "
          @click="emit('mic-click')"
          @pointerdown="emit('mic-down')"
          @pointerup="emit('mic-up')"
          @pointerleave="emit('mic-up')"
          @pointercancel="emit('mic-cancel')"
          @contextmenu.prevent
        >
          <q-icon :name="icon(recordMode === 'video' ? 'video_message' : 'mic')" size="20px" />
        </button>
        <span v-if="recordModeHint" class="record-mode-hint">{{ recordModeHint }}</span>
      </span>
      <button
        v-if="newMessage.trim()"
        class="send-btn"
        title="Отправить"
        :disabled="sending"
        @click="emit('send-text')"
      >
        <q-icon :name="icon('send')" size="18px" />
      </button>

      <!-- Подсказка упоминаний: набрали @ — выбираем участника группы -->
      <div v-if="mentionOpen && mentionMatches.length" class="mention-panel" role="listbox">
        <button
          v-for="(member, index) in mentionMatches"
          :key="member.id"
          type="button"
          role="option"
          :aria-selected="index === mentionIndex"
          class="mention-item"
          :class="{ active: index === mentionIndex }"
          @mousedown.prevent="pickMention(member)"
        >
          <span class="mention-avatar" :style="avatarStyle(displayName(member))">
            <img
              v-if="avatarUrlOf(member)"
              :src="avatarUrlOf(member)"
              class="mention-avatar-img"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <template v-else>{{ initials(displayName(member)) }}</template>
          </span>
          <span class="mention-text">
            <span class="mention-name">{{ displayName(member) }}</span>
            <span class="mention-username">@{{ member.username }}</span>
          </span>
        </button>
      </div>

      <div v-if="extrasPanel !== 'none'" class="extras-menu">
        <div class="extras-tabs">
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'emoji' }"
            @click="emit('set-extras-tab', 'emoji')"
          >
            Эмодзи
          </button>
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'stickers' }"
            @click="emit('set-extras-tab', 'stickers')"
          >
            Стикеры
          </button>
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'gif' }"
            @click="emit('set-extras-tab', 'gif')"
          >
            GIF
          </button>
        </div>
        <div v-if="extrasPanel === 'emoji'" class="emoji-panel">
          <!-- Полоска значков: недавние и категории эмодзи. Лента листается
               колесом и перетаскиванием (мышь) и свайпом. -->
          <div
            ref="emojiCatsEl"
            class="emoji-cats"
            :class="{ 'fade-start': emojiCatsEdges.start, 'fade-end': emojiCatsEdges.end }"
            role="tablist"
            aria-label="Категории эмодзи"
            @scroll.passive="emojiCatsRefresh"
            @wheel.passive="emojiCats.onWheel"
            @pointerdown="emojiCats.onPointerDown"
            @pointermove="emojiCats.onPointerMove"
            @pointerup="emojiCats.onPointerUp"
            @pointerleave="emojiCats.onPointerUp"
            @pointercancel="emojiCats.onPointerUp"
          >
            <button
              v-for="tab in emojiTabs"
              :key="tab.key"
              type="button"
              class="emoji-cat"
              :class="{ active: emojiTab === tab.key }"
              role="tab"
              :title="tab.title"
              :aria-label="tab.title"
              :aria-selected="emojiTab === tab.key"
              @click="emojiTab = tab.key"
            >
              {{ tab.icon }}
            </button>
          </div>
          <p v-if="!emojiItems.length" class="emoji-hint">
            Здесь появятся те, что вы выбирали последними.
          </p>
          <div v-else class="extras-grid">
            <button
              v-for="emoji in emojiItems"
              :key="emoji"
              class="emoji-option"
              @click="pickEmoji(emoji)"
            >
              {{ emoji }}
            </button>
          </div>
        </div>
        <div v-else-if="extrasPanel === 'stickers'" class="stickers-panel">
          <!-- Стикеры: мои картинки (тап — сразу сообщение) и «крупные»
               эмодзи. Управление паками — за кнопкой с шестерёнкой. -->
          <div class="stickers-bar">
            <span class="stickers-hint">Стикер уходит сразу — как сообщение.</span>
            <button type="button" class="stickers-tool" @click="pickStickers">
              <q-icon :name="icon('image')" size="16px" />
              Добавить
            </button>
            <button
              type="button"
              class="stickers-tool"
              title="Мои паки стикеров"
              @click="stickerPacksOpen = true"
            >
              <q-icon :name="icon('tune')" size="16px" />
              Паки
            </button>
          </div>
          <div
            ref="stickerCatsEl"
            class="emoji-cats"
            :class="{ 'fade-start': stickerCatsEdges.start, 'fade-end': stickerCatsEdges.end }"
            role="tablist"
            aria-label="Паки стикеров"
            @scroll.passive="stickerCatsRefresh"
            @wheel.passive="stickerCats.onWheel"
            @pointerdown="stickerCats.onPointerDown"
            @pointermove="stickerCats.onPointerMove"
            @pointerup="stickerCats.onPointerUp"
            @pointerleave="stickerCats.onPointerUp"
            @pointercancel="stickerCats.onPointerUp"
          >
            <button
              v-for="tab in stickerTabs"
              :key="tab.key"
              type="button"
              class="emoji-cat"
              :class="{ active: stickerTab === tab.key }"
              role="tab"
              :aria-selected="stickerTab === tab.key"
              @click="stickerTab = tab.key"
            >
              {{ tab.title }}
            </button>
          </div>
          <p
            v-if="!currentStickerTab?.images.length && !currentStickerTab?.emojis.length"
            class="emoji-hint"
          >
            Здесь появятся стикеры, которые вы отправляли последними. Свои картинки добавляются
            кнопкой «Добавить»: PNG, WebP или GIF до 512 КБ.
          </p>
          <div v-else-if="currentStickerTab?.kind === 'image'" class="extras-grid stickers-grid">
            <button
              v-for="sticker in currentStickerTab.images"
              :key="sticker.id"
              class="sticker-option sticker-image"
              title="Отправить стикер"
              aria-label="Отправить стикер"
              @click="sendImageSticker(sticker)"
            >
              <img :src="mediaUrl(sticker.file_url)" alt="" loading="lazy" />
            </button>
          </div>
          <div v-else class="extras-grid stickers-grid">
            <button
              v-for="sticker in currentStickerTab?.emojis ?? []"
              :key="sticker"
              class="sticker-option"
              :title="`Отправить ${sticker}`"
              :aria-label="`Отправить стикер ${sticker}`"
              @click="sendSticker(sticker)"
            >
              {{ sticker }}
            </button>
          </div>
          <!-- Скрытый input: файлы уходят в текущий пак (см. onStickersSelected). -->
          <input
            ref="stickerInput"
            class="sr-only-input"
            type="file"
            :accept="STICKER_ACCEPT"
            multiple
            @change="onStickersSelected"
          />
        </div>
        <div v-else-if="extrasPanel === 'gif' && chatId !== null" class="extras-gif">
          <GifPicker
            :chat-id="chatId"
            :reply-to-id="replyTarget?.id ?? null"
            @sent="emit('gif-sent')"
          />
        </div>
      </div>

      <!-- Панель «Мои стикеры»: паки, загрузка, порядок. -->
      <StickerPacksDialog v-if="stickerPacksOpen" @close="stickerPacksOpen = false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import type { ChatUser, Message } from '@/types'
import { messageSnippet } from '@/utils/media'
import { applyMention, mentionBeforeCaret } from '@/utils/mentions'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import {
  EMOJI_RECENT_KEY,
  readRecentEmoji,
  readRecentStickers,
  rememberEmoji,
  rememberSticker,
  STICKER_RECENT_KEY
} from '@/utils/emoji'
import type { EmojiCategory } from '@/utils/emojiCatalog'
import { mediaUrl } from '@/config'
import { useStickersStore } from '@/stores/stickers'
import { STICKER_ACCEPT, type StickerItem } from '@/services/stickers'
/**
 * Диалог «Мои стикеры» грузим лениво: он нужен только тем, кто открывает
 * панель стикеров и нажимает «Паки», а в основном чанке это лишние килобайты
 * при каждом запуске приложения.
 */
const StickerPacksDialog = defineAsyncComponent(
  () => import('@/components/messenger/StickerPacksDialog.vue')
)
import { useHScroll } from '@/composables/useHScroll'
import VoiceRecorderBar from '@/components/media/VoiceRecorderBar.vue'
import GifPicker from '@/components/media/GifPicker.vue'
import type { RecordedMedia } from '@/services/recorder'

const props = defineProps<{
  chatId: number | null
  sending: boolean
  sendError: string
  replyTarget: Message | null
  /** Название в шапке цитаты ответа (вычисляется родителем). */
  replyBarName: string
  editingMessage: Message | null
  /** Единое меню доп.контента: 'emoji' | 'stickers' | 'gif' (открыто) либо 'none'. */
  extrasPanel: 'none' | 'emoji' | 'stickers' | 'gif'
  voiceRecOpen: boolean
  recordMode: 'audio' | 'video'
  micHolding: boolean
  recordModeHint: string
  /**
   * Участники группового чата для подсказки упоминаний (пусто — подсказки нет:
   * в личном чате упоминать некого).
   */
  mentionMembers?: ChatUser[]
}>()

// Текст в поле ввода (v-model) изменяется в композере.
const newMessage = defineModel<string>('newMessage', { required: true })

/** Есть ли текст в поле (для скрытия кнопок файла/микрофона при наборе). */
const hasText = computed(() => newMessage.value.trim().length > 0)

// ---------- Эмодзи: категории и недавние ----------
const stickersStore = useStickersStore()

/** Ключ служебной вкладки «Недавние»: остальные — категории каталога. */
const RECENT_KEY = 'recent'

/** Диалог «Мои стикеры» (паки, загрузка, порядок). */
const stickerPacksOpen = ref(false)

const emojiRecent = ref<string[]>(readRecentEmoji(globalThis.localStorage))
const emojiTab = ref<string>(emojiRecent.value.length ? RECENT_KEY : '')

/**
 * Каталог эмодзи (~1900 символов) подгружаем динамическим импортом при первом
 * открытии панели.
 *
 * В основном чанке он стоил бы +8–10 КБ на каждый запуск приложения — ради
 * панели, которую открывают не все и не сразу. Ровно поэтому же лениво грузится
 * GIF (`GifPicker.vue`).
 */
const emojiCategories = ref<EmojiCategory[]>([])
let emojiCategoriesLoading: Promise<void> | null = null

const ensureEmojiCategories = async (): Promise<void> => {
  if (emojiCategories.value.length) return
  if (!emojiCategoriesLoading) {
    emojiCategoriesLoading = import('@/utils/emojiCatalog')
      .then((module) => {
        emojiCategories.value = module.EMOJI_CATEGORIES
      })
      .finally(() => {
        emojiCategoriesLoading = null
      })
  }
  await emojiCategoriesLoading
}

/**
 * Вкладки панели: недавние и все группы эмодзи.
 *
 * Без персональных «паков»: эмодзи одинаков у всех, а паками человек только
 * путался бы, собирая нужные темы вручную. Значок вкладки — эмодзи группы,
 * поэтому подписи не нужны: они остаются в `title` для подсказки и скринридера.
 */
const emojiTabs = computed(() => [
  { key: RECENT_KEY, title: 'Недавние', icon: '🕒', items: emojiRecent.value },
  ...emojiCategories.value.map((category) => ({
    key: category.key,
    title: category.title,
    icon: category.icon,
    items: category.items
  }))
])
const emojiItems = computed(
  () => emojiTabs.value.find((tab) => tab.key === emojiTab.value)?.items ?? []
)

// Панель могла «потерять» текущую вкладку: например, очистили недавние.
watch(emojiTabs, (tabs) => {
  if (tabs.some((tab) => tab.key === emojiTab.value)) return
  emojiTab.value = tabs[0]?.key ?? ''
})

// Панель открыли — грузим каталог и ставим вкладку по умолчанию (недавние,
// если они есть, иначе первую группу).
watch(
  () => props.extrasPanel,
  (panel) => {
    if (panel !== 'emoji') return
    void ensureEmojiCategories().then(() => {
      if (!emojiTab.value) {
        emojiTab.value = emojiRecent.value.length
          ? RECENT_KEY
          : (emojiCategories.value[0]?.key ?? '')
      }
    })
  },
  { immediate: true }
)

/** Вставляет эмодзи и запоминает его для раздела «Недавние». */
const pickEmoji = (emoji: string) => {
  emojiRecent.value = rememberEmoji(emojiRecent.value, emoji)
  try {
    globalThis.localStorage?.setItem(EMOJI_RECENT_KEY, JSON.stringify(emojiRecent.value))
  } catch {
    // Приватный режим/переполнение — не мешаем отправке сообщения.
  }
  emit('append-emoji', emoji)
}

// ---------- Стикеры: тап = отправить ----------
// Вкладка панели: либо мои картинки (стикеры), либо «крупные» эмодзи-стикеры.
type StickerTab = {
  key: string
  title: string
  kind: 'image' | 'emoji'
  images: StickerItem[]
  emojis: string[]
}

const emojiStickerRecent = ref<string[]>(readRecentStickers(globalThis.localStorage))
const stickerTab = ref<string>(RECENT_KEY)

const stickerTabs = computed<StickerTab[]>(() => {
  const tabs: StickerTab[] = [
    { key: RECENT_KEY, title: 'Недавние', kind: 'image', images: stickersStore.recent, emojis: [] }
  ]
  for (const pack of stickersStore.packs) {
    tabs.push({
      key: `pack:${pack.id}`,
      title: pack.title,
      kind: 'image',
      images: pack.stickers,
      emojis: []
    })
  }
  if (emojiStickerRecent.value.length) {
    tabs.push({
      key: 'emoji-recent',
      title: 'Эмодзи',
      kind: 'emoji',
      images: [],
      emojis: emojiStickerRecent.value
    })
  }
  for (const category of emojiCategories.value) {
    tabs.push({
      key: `emoji:${category.key}`,
      title: category.title,
      kind: 'emoji',
      images: [],
      emojis: category.items
    })
  }
  return tabs
})

const currentStickerTab = computed(
  () => stickerTabs.value.find((tab) => tab.key === stickerTab.value) ?? stickerTabs.value[0]
)

watch(stickerTabs, (tabs) => {
  if (tabs.some((tab) => tab.key === stickerTab.value)) return
  stickerTab.value = tabs[0]?.key ?? RECENT_KEY
})

/** Пак, в который уйдёт загрузка: текущая вкладка, иначе первый пак. */
const uploadPackId = computed<number | null>(() => {
  const key = currentStickerTab.value?.key ?? ''
  if (key.startsWith('pack:')) return Number(key.slice(5))
  return stickersStore.packs[0]?.id ?? null
})

// Библиотеку стикеров тянем только когда панель открыли: у тех, кто стикерами
// не пользуется, лишнего запроса не будет.
watch(
  () => props.extrasPanel,
  (panel) => {
    if (panel === 'stickers') {
      // Каталог нужен и в панели стикеров: там эмодзи-стикеры идут вкладками.
      void ensureEmojiCategories()
      void stickersStore.load()
    }
  },
  { immediate: true }
)

/**
 * Отправляет стикер-картинку сообщением.
 *
 * Сервер отдаёт стикер как файл, а сообщение отправляется теми же байтами с
 * ``sticker=true`` — поэтому здесь только достаём картинку и просим отправить.
 */
const sendImageSticker = (sticker: StickerItem) => {
  stickersStore.rememberRecent(sticker.id)
  emit('send-sticker-image', sticker)
}

/** Отправляет эмодзи-стикер (крупный эмодзи) и запоминает его в «Недавние». */
const sendSticker = (sticker: string) => {
  emojiStickerRecent.value = rememberSticker(emojiStickerRecent.value, sticker)
  try {
    globalThis.localStorage?.setItem(STICKER_RECENT_KEY, JSON.stringify(emojiStickerRecent.value))
  } catch {
    // Память не сохранится — отправить это не мешает.
  }
  emit('send-sticker', sticker)
}

// ---------- Загрузка стикеров из панели ----------
const stickerInput = ref<HTMLInputElement | null>(null)

const pickStickers = () => {
  stickerInput.value?.click()
}

/**
 * Загружает выбранные картинки в текущий пак (или в первый, создав его).
 *
 * Ошибки показываем одним сообщением после всей пачки: обычно так грузят
 * несколько стикеров сразу.
 */
const onStickersSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  void (async () => {
    try {
      const packId = uploadPackId.value ?? (await stickersStore.createPack()).id
      const failed: string[] = []
      for (const file of files) {
        try {
          await stickersStore.addSticker(packId, file)
        } catch (cause) {
          failed.push(cause instanceof Error ? cause.message : file.name)
        }
      }
      if (failed.length) {
        emit('sticker-error', `Не добавились: ${failed.join('; ')}`)
        return
      }
      stickerTab.value = `pack:${packId}`
    } catch (cause) {
      emit('sticker-error', cause instanceof Error ? cause.message : 'Не удалось добавить стикер')
    }
  })()
}

// ---------- Ленты вкладок: одна прокрутка на все ----------
// Вкладок (недавние + категории) больше, чем влезает в полосу: без прокрутки
// последние уезжали за край и были недоступны — особенно в веб-версии, где нет
// свайпа. Ленты эмодзи и стикеров показываются по очереди, поэтому у каждой
// свой экземпляр прокрутки.
const {
  el: emojiCatsEl,
  edges: emojiCatsEdges,
  refresh: emojiCatsRefresh,
  ...emojiCats
} = useHScroll(() => emojiTabs.value.length)
const {
  el: stickerCatsEl,
  edges: stickerCatsEdges,
  refresh: stickerCatsRefresh,
  ...stickerCats
} = useHScroll(() => stickerTabs.value.length)

const emit = defineEmits<{
  (e: 'send-text'): void
  (e: 'file-selected', file: File): void
  (e: 'cancel-edit'): void
  (e: 'clear-reply'): void
  (e: 'voice-cancel'): void
  (e: 'voice-send', payload: RecordedMedia): void
  (e: 'mic-down'): void
  (e: 'mic-up'): void
  (e: 'mic-cancel'): void
  (e: 'mic-click'): void
  (e: 'toggle-extras'): void
  (e: 'set-extras-tab', tab: 'emoji' | 'stickers' | 'gif'): void
  (e: 'gif-sent'): void
  (e: 'append-emoji', emoji: string): void
  /** Стикер-эмодзи: отправить сразу отдельным сообщением. */
  (e: 'send-sticker', sticker: string): void
  /** Стикер-картинка: отправить её как сообщение (kind='sticker'). */
  (e: 'send-sticker-image', sticker: StickerItem): void
  /** Сообщение об ошибке добавления стикера (показывает родитель). */
  (e: 'sticker-error', message: string): void
}>()

const attachInput = ref<HTMLInputElement | null>(null)

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('file-selected', file)
}

// ---------- Вставка файла из буфера обмена ----------
// Перетаскивание файлов живёт не здесь, а в `useFileDrop` (слушатели на окне):
// бросить файл можно в любое место приложения, поэтому и подсветка одна на всё
// приложение — см. FileDropOverlay. Здесь остаётся только вставка из буфера
// (Ctrl+V с картинкой) — она привязана к полю ввода.
/** Вставка картинки из буфера (Ctrl+V) — отправляем как вложение. */
const onTextPaste = (event: ClipboardEvent) => {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        event.preventDefault()
        emit('file-selected', file)
        return
      }
    }
  }
}

// ---------- Ввод с клавиатуры ----------
// Десктоп: Enter — отправка, Shift+Enter — новая строка.
// Мобильный (тач): Enter виртуальной клавиатуры вставляет перевод строки,
// отправить можно кнопкой «Отправить» (как в Telegram/WhatsApp).
const isTouchPrimary = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(pointer: coarse)').matches

const onTextKeydown = (event: KeyboardEvent) => {
  // Подсказка упоминаний перехватывает навигацию и выбор участника.
  if (mentionOpen.value && mentionMatches.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const count = mentionMatches.value.length
      mentionIndex.value = (mentionIndex.value + delta + count) % count
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pickMention(mentionMatches.value[mentionIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      mentionOpen.value = false
      return
    }
  }
  if (event.key !== 'Enter') return
  // Shift+Enter — перенос строки (браузер делает сам), не перехватываем.
  if (event.shiftKey) return
  // Тач-устройства: Enter = перевод строки (не отправка).
  if (isTouchPrimary()) return
  event.preventDefault()
  emit('send-text')
}

// ---------- Упоминания участников (@логин) ----------
/** Сколько подсказок показываем разом. */
const MENTION_LIMIT = 6

const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionStart = ref(0)
const mentionIndex = ref(0)

/** Подходящие участники: ищем по логину и имени, себя не предлагаем. */
const mentionMatches = computed<ChatUser[]>(() => {
  const members = props.mentionMembers ?? []
  if (members.length === 0) return []
  const query = mentionQuery.value.toLowerCase()
  const matches = members.filter((member) => {
    if (!member.username) return false
    if (!query) return true
    return (
      member.username.toLowerCase().includes(query) ||
      displayName(member).toLowerCase().includes(query)
    )
  })
  return matches.slice(0, MENTION_LIMIT)
})

/** Пересчитать подсказку по текущему тексту и позиции курсора. */
const updateMentions = () => {
  if ((props.mentionMembers ?? []).length === 0) {
    mentionOpen.value = false
    return
  }
  const input = textInputRef.value
  if (!input) return
  const found = mentionBeforeCaret(newMessage.value, input.selectionStart ?? 0)
  if (!found) {
    mentionOpen.value = false
    return
  }
  mentionQuery.value = found.query
  mentionStart.value = found.start
  mentionIndex.value = 0
  mentionOpen.value = true
}

/** Вставить выбранный логин вместо набранного `@...` и вернуть курсор в конец. */
const pickMention = (member: ChatUser) => {
  const input = textInputRef.value
  const caret = input?.selectionStart ?? newMessage.value.length
  const next = applyMention(newMessage.value, mentionStart.value, caret, member.username)
  newMessage.value = next.text
  mentionOpen.value = false
  void nextTick(() => {
    input?.focus()
    input?.setSelectionRange(next.caret, next.caret)
    autoGrow()
  })
}

const onTextInput = () => {
  autoGrow()
  updateMentions()
}

// Закрываем подсказку при выходе из режима ввода/смене чата.
watch(
  () => [props.chatId, props.editingMessage?.id] as const,
  () => {
    mentionOpen.value = false
  }
)

// ---------- Авто-рост многострочного поля ----------
const textInputRef = ref<HTMLTextAreaElement | null>(null)
/** Максимальная высота поля ввода (пикселей) — примерно 6 строк. */
const TEXTAREA_MAX_HEIGHT = 140

/**
 * Поставить курсор в поле ввода.
 *
 * Нужно родителю: кнопка «Ответить» в уведомлении открывает чат уже готовым к
 * вводу (в вебе нельзя печатать текст прямо в уведомлении).
 */
const focusInput = () => {
  textInputRef.value?.focus()
}

defineExpose({ focusInput })

const autoGrow = () => {
  const el = textInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
}

// Сброс высоты при очистке/подстановке текста (например, после отправки).
watch(newMessage, () => {
  void nextTick(autoGrow)
})
</script>

<style scoped>
.input-area {
  padding: 10px 14px;
  background: var(--ms-surface-2);
  border-top: 1px solid var(--ms-border);
  position: relative;
}

/* Перетаскивание файла в окно подсвечивает оверлеем (FileDropOverlay), а не
   полосой ввода: бросить файл можно в любое место приложения. */

.round-btn.muted {
  color: var(--ms-icon-3);
}

.inline-error {
  color: var(--ms-danger);
  font-size: 12px;
  padding: 6px 14px;
  background: var(--ms-danger-bg);
  margin-bottom: 6px;
}

/* Кнопка записи голосового/видеосообщения (удержание 2 c — переключение режима) */
.mic-wrap {
  position: relative;
  display: inline-flex;
}

.mic-hold-btn {
  position: relative;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  /* Кнопка записи — акцентная (и голосовое, и видео): это главное действие
     композера, как кнопки звонков в шапке чата. Соседние «прикрепить» и
     «эмодзи» — служебные, они остаются серыми. */
  color: var(--ms-accent);
}

/* Наведение: фон даёт общий слой (`html .messenger-shell .round-btn:hover` в
   appearance.css), но он же меняет цвет на `--ms-text` — и акцент гаснет. У
   слоя специфичность выше scoped-правила, поэтому возвращаем цвет через
   :global (тот же приём, что в StoriesStrip.vue). */
:global(html .messenger-shell .mic-hold-btn:hover) {
  color: var(--ms-accent);
}

.mic-hold-btn.mode-video {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
}

/* Идёт запись — состояние сильнее режима: кнопка заливается акцентом целиком,
   поэтому правила «удержания» идут последними (раньше `mode-video` стоял ниже
   и в режиме видео во время записи оставлял бледную подложку). */
.mic-hold-btn.holding {
  background: var(--ms-accent);
  color: var(--ms-on-accent);
}

.mic-hold-btn.holding .q-icon {
  color: var(--ms-on-accent);
}

.mic-hold-btn.holding::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid var(--ms-accent);
  opacity: 0;
  animation: mic-hold-ring 2s ease-out forwards;
  pointer-events: none;
}

/* Подсказка о смене режима */
.record-mode-hint {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--ms-tooltip-bg);
  color: var(--ms-tooltip-text);
  padding: 4px 10px;
  border-radius: 10px;
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  z-index: 12;
  animation: record-hint-pop 0.15s ease-out;
}

@keyframes record-hint-pop {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes mic-hold-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.92);
  }
  100% {
    opacity: 0;
    transform: scale(1.6);
  }
}

.reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--ms-surface);
  border-left: 3px solid var(--ms-info);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
}

.reply-bar-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.reply-bar-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ms-info);
}

.reply-bar-text {
  font-size: 13px;
  color: var(--ms-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ms-surface);
  border-radius: 12px;
  padding: 5px 10px;
  position: relative;
}

.text-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: calc(15px * var(--ms-text-scale, 1));
  line-height: 1.35;
  background: transparent;
  padding: 7px 4px;
  color: var(--ms-text-strong);
  caret-color: var(--ms-accent);
  resize: none;
  overflow-y: auto;
  min-height: 24px;
  max-height: 140px;
  font-family: inherit;
  /* Прячем скроллбар поля: иначе после набора рядом со смайлом остаётся
     серая вертикальная полоса (прокрутка при этом сохраняется). */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.text-input::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.send-btn {
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
}

.send-btn:hover {
  background: var(--ms-accent-strong);
}

.hidden-file {
  display: none;
}

/* Единое меню «Эмодзи / GIF» (над строкой ввода) */
/* Подсказка упоминаний: список участников над полем ввода */
.mention-panel {
  position: absolute;
  bottom: 58px;
  left: 10px;
  right: 10px;
  max-width: min(420px, calc(100vw - 28px));
  max-height: 46vh;
  overflow-y: auto;
  z-index: 30;
  padding: 6px;
  border-radius: 14px;
  background: var(--ms-surface, #fff);
  border: 1px solid var(--ms-border, #e2e6ea);
  box-shadow: var(--ms-shadow-float, 0 6px 20px -8px rgba(15, 23, 42, 0.3));
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ms-text, #1c2733);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mention-item.active,
.mention-item:hover {
  background: var(--ms-surface-2, #eef1f4);
}

.mention-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--ms-on-accent);
  font-size: 12px;
  font-weight: 700;
}

.mention-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mention-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mention-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mention-username {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.extras-menu {
  position: absolute;
  bottom: 58px;
  right: 14px;
  width: min(360px, calc(100vw - 28px));
  background: var(--ms-surface);
  border-radius: 16px;
  box-shadow: var(--ms-shadow-pop);
  padding: 8px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.extras-tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--ms-border);
  padding-bottom: 6px;
}

.extras-tab {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 9px;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-icon-2);
  cursor: pointer;
}

.extras-tab.active {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
}

/* Полоска значков: «Недавние» и категории эмодзи. */
.emoji-cats {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: none;
}

.emoji-cats::-webkit-scrollbar {
  display: none;
}

.emoji-cat {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: none;
  border-radius: 10px;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font: inherit;
  font-size: var(--ms-fs-lg);
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
}

.emoji-cat.active {
  background: var(--ms-accent-soft);
}

.emoji-hint {
  margin: 6px 2px;
  font-size: 12px;
  color: var(--ms-muted);
}

.extras-grid {
  display: grid;
  grid-template-columns: repeat(8, 32px);
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}

/* GIF внутри единого меню: выключаем собственное абсолютное позиционирование */
.extras-menu :deep(.gif-picker) {
  position: static;
  bottom: auto;
  right: auto;
  width: 100%;
  max-width: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
  z-index: auto;
  max-height: 260px;
  overflow-y: auto;
}

.extras-menu :deep(.gif-picker-inner) {
  max-height: none;
}

/* Панель стикеров: крупные плитки, тап = отправка. */
.stickers-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stickers-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stickers-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 3px 8px;
  border: none;
  border-radius: 10px;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font: inherit;
  font-size: var(--ms-fs-xs);
  cursor: pointer;
}

.stickers-tool:hover {
  background: var(--ms-hover);
  color: var(--ms-accent);
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.stickers-hint {
  margin: 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.stickers-grid {
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
}

.sticker-option {
  background: transparent;
  border: none;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sticker-option:hover {
  background: var(--ms-hover);
  transform: scale(1.08);
}

/* Стикер-картинка: показываем целиком и не растягиваем за пропорции. */
.sticker-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.emoji-option {
  background: transparent;
  border: none;
  font-size: 19px;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.emoji-option:hover {
  background: var(--ms-hover);
  transform: scale(1.18);
}

.emoji-option.active {
  background: var(--ms-accent-soft);
}

/* ---------- Мобильная адаптация ---------- */
.input-area {
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
}

@media (max-width: 420px) {
  .input-row {
    gap: 6px;
    padding: 4px 6px;
  }
  /* Размер кнопок здесь НЕ уменьшаем: 30 px для пальца мало (общий телефонный
     размер — 38 px в appearance.css), а зазор 2 px превращал промах в нажатие
     по соседней кнопке. */
}
</style>
