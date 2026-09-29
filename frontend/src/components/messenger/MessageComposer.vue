<template>
  <div class="input-area" :class="{ expanded, multiline }">
    <!-- В развёрнутом вводе «свернуть» — отдельной кнопкой в самом верху
         панели: у нижней строки значок стоял рядом с отправкой и мешал ей. -->
    <div v-if="expanded" class="expand-bar">
      <button
        class="icon-btn collapse-btn"
        :title="t('Свернуть')"
        :aria-label="t('Свернуть')"
        @click="collapse()"
      >
        <q-icon :name="icon('arrow_downward')" size="20px" />
      </button>
    </div>
    <ErrorNotice
      v-if="sendError"
      :message="sendError"
      :can-retry="canRetrySend"
      @dismiss="emit('dismiss-error')"
      @retry="emit('retry-error')"
    />

    <!-- Редактирование сообщения -->
    <div v-if="editingMessage" class="reply-bar mode-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">{{ t('Редактирование') }}</span>
        <span class="reply-bar-text">{{ editingMessage.text }}</span>
      </div>
      <button class="icon-btn" :title="t('Отмена')" @click="emit('cancel-edit')">
        <q-icon :name="icon('close')" size="20px" />
      </button>
    </div>

    <!-- Цитата ответа -->
    <div v-if="replyTarget" class="reply-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">{{ replyBarName }}</span>
        <span class="reply-bar-text">{{ messageSnippet(replyTarget) }}</span>
      </div>
      <button class="icon-btn" :title="t('Отменить ответ')" @click="emit('clear-reply')">
        <q-icon :name="icon('close')" size="20px" />
      </button>
    </div>

    <VoiceRecorderBar
      v-if="voiceRecOpen"
      @cancel="emit('voice-cancel')"
      @send="(payload) => emit('voice-send', payload)"
    />
    <div v-else class="input-row">
      <!-- Обёртка нужна, чтобы меню привязалось к кнопке, а не ко всей строке.
           Кнопка видна ВСЕГДА: пока она исчезала при наборе текста, поле ввода
           разъезжалось на её ширину и текст в нём прыгал влево (в Телеграме
           скрепка тоже остаётся). -->
      <span class="attach-wrap">
        <button
          class="round-btn"
          :title="t('Прикрепить файл')"
          :aria-expanded="attachMenuOpen"
          @click="attachMenuOpen = !attachMenuOpen"
        >
          <q-icon :name="icon('attach_file')" size="20px" />
        </button>
        <!-- Что именно прикрепляем: обычный файл или одноразовое медиа -->
        <q-menu v-model="attachMenuOpen" anchor="top middle" self="bottom middle" no-parent-event>
          <div class="attach-menu">
            <button type="button" class="attach-item" @click="pickAttachment(false)">
              <q-icon :name="icon('attach_file')" size="18px" />
              <span>{{ t('Файл или фото') }}</span>
            </button>
            <button type="button" class="attach-item" @click="pickAttachment(true)">
              <q-icon :name="icon('schedule')" size="18px" />
              <span>{{ t('Посмотреть один раз') }}</span>
            </button>
            <p class="attach-hint">
              {{ t('Одноразовое медиа сгорит после первого просмотра: его нельзя переслать.') }}
            </p>
          </div>
        </q-menu>
      </span>
      <input
        ref="attachInput"
        class="hidden-file"
        type="file"
        multiple
        :accept="viewOncePick ? 'image/*,video/*' : undefined"
        :aria-label="t('Прикрепить файл')"
        @change="onFileSelected"
      />
      <!-- Поле со значком разворота: значок живёт внутри поля у правого края,
           поэтому не отнимает ширину у текста (раньше отдельная кнопка съедала
           44 px), а в развёрнутом виде оказывается сверху — там, где и должен
           быть «свернуть» (внизу он перекрывал отправку). -->
      <span class="editor-slot">
        <textarea
          ref="textInputRef"
          v-model="newMessage"
          class="text-input"
          rows="1"
          :placeholder="t('Сообщение')"
          :aria-label="t('Сообщение')"
          @keydown="onTextKeydown"
          @input="onTextInput"
          @click="updateMentions"
          @select="syncSelectionMenu"
          @pointerup="syncSelectionMenu"
          @keyup="syncSelectionMenu"
          @scroll.passive="syncSelectionMenu"
          @blur="closeSelectionMenu"
          @paste="onTextPaste"
        ></textarea>
        <button
          class="field-toggle"
          :title="expanded ? t('Свернуть') : t('Развернуть поле ввода')"
          :aria-label="expanded ? t('Свернуть') : t('Развернуть поле ввода')"
          :aria-expanded="expanded"
          @click="toggleExpand()"
        >
          <!-- Стрелки, а не шевроны: значок должен читаться как «поле растёт вверх»
               на весь экран и «убирается вниз» в строку (владелец, 29.09.2026). -->
          <q-icon :name="icon(expanded ? 'arrow_downward' : 'arrow_upward')" size="18px" />
        </button>
        <!-- Формат по выделению: в обычной строке кнопки «Aa» нет, поэтому
             знаки разметки предлагаются над полем, как только в нём что-то
             выделили. Клик ловим на `mousedown`, иначе поле теряет фокус и
             выделение пропадает до того, как правка применится (тот же приём,
             что у подсказки упоминаний). -->
        <div
          v-if="selectionMenuOpen"
          ref="selectionMenuEl"
          class="selection-menu ms-pop"
          :style="selectionMenuStyle"
          role="toolbar"
          :aria-label="t('Форматирование текста')"
        >
          <button
            v-for="item in MARKUP_ITEMS"
            :key="item.kind"
            type="button"
            class="selection-item markup-item"
            :class="`kind-${item.kind}`"
            :title="t(item.label)"
            :aria-label="t(item.label)"
            @mousedown.prevent="applyFormat(item.kind)"
          >
            {{ t(item.label) }}
          </button>
        </div>
      </span>
      <!-- Кнопки справа от поля — одной группой (общая обёртка): в развёрнутом
           вводе они собираются в тесный ряд под полем, а не разъезжаются по
           краям экрана. -->
      <span class="input-tools">
        <button
          class="round-btn extras-toggle"
          :class="{ active: extrasPanel !== 'none' }"
          :title="t('Эмодзи и GIF')"
          :aria-expanded="extrasPanel !== 'none'"
          @click="emit('toggle-extras')"
        >
          <q-icon :name="icon('sentiment_satisfied_alt')" size="20px" />
        </button>
        <!-- Формат текста: обрамляет выделенный кусок знаками разметки
           (`*жирный*`, `_курсив_`, `__подчёркнутый__`, `~~зачёркнутый~~`,
           `` `код` ``, `||спойлер||`), а «Цитата» ставит `> ` в начале строк.
           В обычной строке кнопки «Aa» нет ни на телефоне, ни на компьютере:
           там формат предлагает панель по выделению (`.selection-menu`). Сама
           кнопка живёт только в развёрнутом вводе, где для неё есть место. -->
        <span v-if="expanded" class="format-wrap">
          <button
            class="round-btn format-btn"
            :class="{ active: formatMenuOpen }"
            :title="t('Форматирование текста')"
            :aria-label="t('Форматирование текста')"
            :aria-expanded="formatMenuOpen"
            @click="formatMenuOpen = !formatMenuOpen"
          >
            Aa
          </button>
          <q-menu v-model="formatMenuOpen" anchor="top middle" self="bottom middle" no-parent-event>
            <div class="format-menu">
              <button
                v-for="item in MARKUP_ITEMS"
                :key="item.kind"
                type="button"
                class="attach-item markup-item"
                :class="`kind-${item.kind}`"
                @click="applyFormat(item.kind)"
              >
                {{ t(item.label) }}
              </button>
            </div>
          </q-menu>
        </span>
        <!-- Микрофон и отправка делят одну ячейку: кнопка записи «перетекает» в
           отправку (как в Telegram), а не подменяется мгновенно. -->
        <span class="action-slot">
          <Transition name="action-morph">
            <span v-if="!hasText" key="mic" class="mic-wrap">
              <button
                class="round-btn mic-hold-btn"
                :class="{
                  holding: micHolding,
                  'mode-video': recordMode === 'video'
                }"
                :title="
                  recordMode === 'video'
                    ? t('Видеосообщение (нажмите). Удерживайте 2 секунды — голосовое')
                    : t('Голосовое сообщение (нажмите). Удерживайте 2 секунды — видеосообщение')
                "
                :aria-label="
                  recordMode === 'video'
                    ? t('Записать видеосообщение. Удерживайте 2 секунды для голосового')
                    : t('Записать голосовое сообщение. Удерживайте 2 секунды для видеосообщения')
                "
                @click="emit('mic-click')"
                @pointerdown="emit('mic-down')"
                @pointerup="emit('mic-up')"
                @pointerleave="emit('mic-up')"
                @pointercancel="emit('mic-cancel')"
                @contextmenu.prevent
              >
                <q-icon
                  :name="icon(recordMode === 'video' ? 'video_message' : 'mic')"
                  size="20px"
                />
              </button>
              <span v-if="recordModeHint" class="record-mode-hint">{{ recordModeHint }}</span>
            </span>
            <!-- Обёртка нужна, чтобы меню привязалось к кнопке, а не ко всей строке -->
            <span v-else key="send" class="send-wrap">
              <button
                class="send-btn"
                :title="t('Отправить. Удерживайте или нажмите правой кнопкой — отправить позже')"
                :disabled="sending"
                @click="onSendClick"
                @pointerdown="startScheduleHold"
                @pointerup="cancelScheduleHold"
                @pointerleave="cancelScheduleHold"
                @pointercancel="cancelScheduleHold"
                @contextmenu.prevent="openScheduleMenu"
              >
                <q-icon :name="icon('send')" size="18px" />
              </button>
              <!-- «Отправить позже»: варианты времени считаются от текущей минуты -->
              <q-menu
                v-model="scheduleMenuOpen"
                anchor="top right"
                self="bottom right"
                no-parent-event
              >
                <div class="attach-menu">
                  <button
                    v-for="preset in scheduleOptions"
                    :key="preset.label"
                    type="button"
                    class="attach-item"
                    @click="pickSchedule(preset)"
                  >
                    <q-icon :name="icon('schedule')" size="18px" />
                    <span>{{ t(preset.label) }}</span>
                  </button>
                  <p class="attach-hint">
                    {{
                      t(
                        'Сообщение уйдёт в назначенное время, даже если приложение закрыто. Текст останется только текстом: вложения отложить нельзя.'
                      )
                    }}
                  </p>
                </div>
              </q-menu>
            </span>
          </Transition>
        </span>
      </span>

      <!-- Подсказка упоминаний: набрали @ — выбираем участника группы -->
      <div v-if="mentionOpen && mentionMatches.length" class="mention-panel ms-pop" role="listbox">
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

      <div
        v-if="extrasPanel !== 'none'"
        ref="extrasMenuEl"
        class="extras-menu"
        :style="panelSwipeOffset ? { transform: `translateY(${panelSwipeOffset}px)` } : undefined"
        @touchstart.passive="onPanelTouchStart"
        @touchmove.passive="onPanelTouchMove"
        @touchend.passive="onPanelTouchEnd"
        @touchcancel.passive="onPanelTouchEnd"
      >
        <div class="extras-tabs">
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'emoji' }"
            @click="emit('set-extras-tab', 'emoji')"
          >
            {{ t('Эмодзи') }}
          </button>
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'stickers' }"
            @click="emit('set-extras-tab', 'stickers')"
          >
            {{ t('Стикеры') }}
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
        <div
          v-if="extrasPanel === 'emoji' || extrasPanel === 'stickers'"
          class="media-panel"
          :class="extrasPanel === 'stickers' ? 'stickers-panel' : 'emoji-panel'"
        >
          <!-- Панель как в Telegram: сверху лента значков (категории эмодзи или
               паки стикеров), ниже — содержимое столбиком. Лента служит быстрым
               переходом к секции и подсвечивает ту, что сейчас на экране. -->
          <div v-if="extrasPanel === 'stickers'" class="stickers-bar">
            <span class="stickers-hint">{{ t('Стикер уходит сразу — как сообщение.') }}</span>
            <button type="button" class="stickers-tool" @click="pickStickers">
              <q-icon :name="icon('image')" size="16px" />
              {{ t('Добавить') }}
            </button>
            <button
              type="button"
              class="stickers-tool"
              :title="t('Мои паки стикеров')"
              @click="stickerPacksOpen = true"
            >
              <q-icon :name="icon('tune')" size="16px" />
              {{ t('Паки') }}
            </button>
          </div>
          <div
            v-if="panelSections.length"
            :ref="panelStrip.el"
            class="panel-strip"
            :class="{ 'fade-start': panelStripEdges.start, 'fade-end': panelStripEdges.end }"
            role="tablist"
            :aria-label="extrasPanel === 'emoji' ? t('Категории эмодзи') : t('Паки стикеров')"
            @scroll.passive="panelStripRefresh"
            @wheel.passive="panelStrip.onWheel"
            @pointerdown="panelStrip.onPointerDown"
            @pointermove="panelStrip.onPointerMove"
            @pointerup="panelStrip.onPointerUp"
            @pointerleave="panelStrip.onPointerUp"
            @pointercancel="panelStrip.onPointerUp"
          >
            <button
              v-for="section in panelSections"
              :key="section.key"
              type="button"
              class="panel-strip-item"
              :class="{ active: activeSection === section.key }"
              role="tab"
              :title="t(section.title)"
              :aria-label="t(section.title)"
              :aria-selected="activeSection === section.key"
              @click="jumpToSection(section.key)"
            >
              <img v-if="section.imageUrl" :src="section.imageUrl" alt="" loading="lazy" />
              <template v-else>{{ section.icon }}</template>
            </button>
          </div>
          <div ref="panelScrollEl" class="panel-scroll" @scroll.passive="onPanelScroll">
            <PanelSection
              v-for="(section, index) in panelSections"
              :key="section.key"
              :section-key="section.key"
              :title="t(section.title)"
              :count="section.images.length || section.emojis.length"
              :force="index <= forcedSectionsUpTo"
            >
              <div v-if="section.images.length" class="extras-grid stickers-grid">
                <button
                  v-for="image in section.images"
                  :key="image.url"
                  class="sticker-option sticker-image"
                  :title="t('Отправить: {alt}', { alt: image.alt })"
                  :aria-label="t('Отправить стикер {alt}', { alt: image.alt })"
                  @click="tapImage(image)"
                >
                  <img :src="image.url" alt="" loading="lazy" />
                </button>
              </div>
              <div v-else-if="section.emojis.length" class="extras-grid stickers-grid">
                <button
                  v-for="emoji in section.emojis"
                  :key="emoji"
                  class="sticker-option"
                  :title="t('Отправить {emoji}', { emoji })"
                  :aria-label="t('Отправить {emoji}', { emoji })"
                  @click="section.kind === 'emoji-pick' ? pickEmoji(emoji) : sendSticker(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>
              <p v-else class="emoji-hint">
                {{ section.emptyHint ?? t('Здесь пока пусто.') }}
              </p>
              <!-- Одна кнопка набора под сеткой — как «ДОБАВИТЬ СТИКЕРЫ» в
                   Телеграме: и действие, и его ход видно сразу, искать «⋯» и
                   удерживать стикер не нужно. -->
              <button
                v-if="setAddStateOf(section)"
                type="button"
                class="set-add-wide"
                :class="`state-${setAddStateOf(section)}`"
                :disabled="setAddStateOf(section) !== 'add' || importingSetKey !== null"
                @click="addSetFromPanel(section)"
              >
                <q-icon
                  :name="icon(setAddStateOf(section) === 'added' ? 'check' : 'add')"
                  size="16px"
                />
                <span>{{ setAddLabelOf(section) }}</span>
              </button>
            </PanelSection>
            <p v-if="!panelSections.length" class="emoji-hint">{{ t('Загружаем…') }}</p>
          </div>
          <!-- Скрытый input: файлы уходят в первый пак (см. onStickersSelected). -->
          <input
            v-if="extrasPanel === 'stickers'"
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
            :caption="newMessage.trim()"
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
import { t } from '@/i18n'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'
import ErrorNotice from '@/components/common/ErrorNotice.vue'
import type { ChatUser, Message } from '@/types'
import { messageSnippet } from '@/utils/media'
import { applyMention, mentionBeforeCaret } from '@/utils/mentions'
import { applyMarkup, type MarkupKind } from '@/utils/markup'
import { caretBox, menuAnchor, type CaretBox } from '@/utils/selectionMenu'
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
import { getErrorMessage } from '@/services/errors'
import { STICKER_ACCEPT, type StickerItem } from '@/services/stickers'
import { useHScroll } from '@/composables/useHScroll'
import { useMobileLayer } from '@/composables/useMobileOverlay'
import { schedulePresets, scheduledSendAt, type SchedulePreset } from '@/utils/scheduledSend'
import PanelSection from '@/components/messenger/PanelSection.vue'
import { STANDARD_STICKER_PACKS, type StandardStickerPack } from '@/utils/standardStickers'
import { useStandardSetImport } from '@/composables/useStandardSetImport'
/**
 * Диалог «Мои стикеры» грузим лениво: он нужен только тем, кто открывает
 * панель стикеров и нажимает «Паки», а в основном чанке это лишние килобайты
 * при каждом запуске приложения.
 */
const StickerPacksDialog = defineAsyncComponent(
  () => import('@/components/messenger/StickerPacksDialog.vue')
)
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
  /**
   * Неудачную отправку можно повторить: плашка ошибки показывает «Повторить»,
   * а сам повтор делает родитель (у него содержимое отправки).
   */
  canRetrySend?: boolean
}>()

// Текст в поле ввода (v-model) изменяется в композере.
const newMessage = defineModel<string>('newMessage', { required: true })

/** Есть ли текст в поле (для скрытия кнопок файла/микрофона при наборе). */
const hasText = computed(() => newMessage.value.trim().length > 0)

// ---------- Эмодзи: категории и недавние ----------
const stickersStore = useStickersStore()

/** Диалог «Мои стикеры» (паки, загрузка, порядок). */
const stickerPacksOpen = ref(false)

// Диалог — слой общего стека (см. `useMobileOverlay`): на телефоне «назад»
// закрывает его, а не выходит из приложения.
useMobileLayer(
  () => stickerPacksOpen.value,
  () => {
    stickerPacksOpen.value = false
  }
)
const emojiRecent = ref<string[]>(readRecentEmoji(globalThis.localStorage))

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

// Панель открыли — грузим каталог (для обеих панелей: эмодзи и стикеров).
watch(
  () => props.extrasPanel,
  (panel) => {
    if (panel === 'emoji' || panel === 'stickers') void ensureEmojiCategories()
    // Библиотеку стикеров тянем только когда открыли панель стикеров: у тех,
    // кто ими не пользуется, лишнего запроса не будет.
    if (panel === 'stickers') {
      void stickersStore.load()
      // Публичные наборы «могут меняться» (суперадмин публикует новые) — читаем
      // их вместе с библиотекой, когда панель открывают.
      void stickersStore.loadPresets()
    }
  },
  { immediate: true }
)

/**
 * Одна секция панели: заголовок в столбике и значок в ленте.
 *
 * `kind` решает, что делает тап по элементу: эмодзи вставляется в текст
 * (`emoji-pick`), а стикер и «крупный» эмодзи сразу уходят сообщением.
 */
interface PanelSectionItem {
  key: string
  title: string
  kind: 'emoji-pick' | 'emoji-send' | 'sticker-send'
  /** Значок для ленты: эмодзи категории или 🕒 у «Недавних». */
  icon: string
  /** Превью пака в ленте (первый стикер) — вместо значка. */
  imageUrl: string | null
  emojis: string[]
  images: PanelImage[]
  /** Что сказать, если секция пуста (иначе — общая строка). */
  emptyHint?: string
  /**
   * id ПУБЛИЧНОГО набора с сервера: по нему работает «Добавить весь набор»
   * (один запрос копирования, без загрузки картинок).
   */
  presetPackId?: number
}

/**
 * Картинка-стикер в панели: своя (с сервера) или стандартная (ассет приложения).
 *
 * Отправка у них одна и та же — скачать байты и уйти сообщением с
 * `sticker=true`, поэтому различаем только источник ссылки: серверный стикер
 * идёт через `mediaUrl`, стандартный — как статический файл приложения.
 */
interface PanelImage {
  url: string
  alt: string
  /** Id серверного стикера: по нему помним «Недавние» и мime. */
  sticker?: StickerItem
  /**
   * Предустановленный набор и имя файла: уезжают в имени файла сообщения
   * (`st-<набор>-<имя>.png`), чтобы у получателя в меню стикера появилось
   * «Добавить набор» — см. `utils/presetStickers.ts`.
   */
  preset?: { setKey: string; name: string }
  /**
   * Пак на сервере, из которого стикер: уезжает меткой `sp-<id>-<имя>.png`, по ней
   * получатель открывает и добавляет набор (окно набора по тапу на стикер).
   */
  pack?: { packId: number; position: number }
}

/** Стикер с сервера → картинка панели (лежит в `media/`, отдаётся через API). */
const mediaImage = (sticker: StickerItem): PanelImage => ({
  url: mediaUrl(sticker.file_url),
  alt: t('Стикер'),
  sticker
})

/** Стандартный стикер приложения → картинка панели (статический файл). */
const standardImages = (key: string): PanelImage[] =>
  (STANDARD_STICKER_PACKS.find((pack) => pack.key === key)?.stickers ?? []).map((sticker) => ({
    url: sticker.url,
    alt: t(sticker.label),
    preset: { setKey: key, name: sticker.name }
  }))

/** Встроенные наборы по ключу секции панели: `standard:<key>` → набор. */
const standardSets = computed<Record<string, StandardStickerPack>>(() =>
  Object.fromEntries(STANDARD_STICKER_PACKS.map((pack) => [`standard:${pack.key}`, pack]))
)

const standardSetOf = (sectionKey: string): StandardStickerPack | undefined =>
  standardSets.value[sectionKey]

/**
 * «Добавить весь набор» из панели стикеров — то же, что кнопка в окне
 * «Мои стикеры» (общая логика в `useStandardSetImport`).
 *
 * Ошибку отдаём тем же путём, что и неудачную загрузку стикера
 * (`sticker-error`): родитель показывает её плашкой, и в приложении это
 * единственный способ сказать «почему не получилось».
 */
const {
  importingKey: importingSetKey,
  label: setImportLabel,
  run: runSetImport
} = useStandardSetImport()

/** Ключ ВСТРОЕННОГО набора у секции (null — секция не про встроенный набор). */
const staticSetKeyOf = (section: PanelSectionItem): string | null =>
  standardSetOf(section.key)?.key ?? null

/**
 * У секции есть действие «добавить набор».
 *
 * Два источника: ВСТРОЕННЫЙ набор приложения (статика в `public/`, добавляется
 * скачиванием картинок) и ПУБЛИЧНЫЙ набор с сервера (`presetPackId`, добавляется
 * одним запросом копирования). Остальные секции — «Недавние», свои паки, эмодзи:
 * добавлять в них нечего.
 */
const hasSetOf = (section: PanelSectionItem): boolean =>
  section.presetPackId !== undefined || staticSetKeyOf(section) !== null

/** Набор уже добавлен себе: встроенный — по отметке, серверный — по названию пака. */
const isSetAdded = (section: PanelSectionItem): boolean => {
  if (section.presetPackId !== undefined) {
    return stickersStore.packs.some((pack) => pack.title === section.title)
  }
  const key = staticSetKeyOf(section)
  return key !== null && stickersStore.isStandardSetImported(key)
}

/** Серверный набор копируется: кнопка показывает «Добавляем…» и не нажимается. */
const presetBusyPackId = ref<number | null>(null)

/** Состояние кнопки набора: добавить / идёт добавление / уже добавлен. */
type SetAddState = 'add' | 'busy' | 'added'

/**
 * Что показывает кнопка набора (null — у секции набора нет: «Недавние», свои
 * паки, эмодзи; добавлять там нечего).
 *
 * Путь к действию ОДИН: кнопка под сеткой. Ни меню «⋯» у заголовка, ни удержания
 * стикера нет — два-три входа в одно и то же заставляли гадать, какой из них
 * «настоящий», а прогресс добавления приходилось показывать в двух местах.
 */
const setAddStateOf = (section: PanelSectionItem): SetAddState | null => {
  if (!hasSetOf(section)) return null
  if (isSetAdded(section)) return 'added'
  if (section.presetPackId !== undefined) {
    return presetBusyPackId.value === section.presetPackId ? 'busy' : 'add'
  }
  return importingSetKey.value === staticSetKeyOf(section) ? 'busy' : 'add'
}

/** Подпись кнопки: у добавления виден счётчик, у ожидания лимита — секунды. */
const setAddLabelOf = (section: PanelSectionItem): string => {
  const state = setAddStateOf(section)
  if (state === 'added') return t('Добавлен')
  const set = standardSetOf(section.key)
  // `setImportLabel` отдаёт прогресс, пока набор добавляется (там же ожидание
  // лимита загрузок), поэтому его берём только для хода добавления.
  if (state === 'busy') return set ? setImportLabel(set) : t('Добавляем…')
  return t('Добавить весь набор')
}

/**
 * «Добавить весь набор» из панели.
 *
 * Серверный набор копируется ОДНИМ запросом (файлы переиспользуются), встроенный
 * — импортом по картинкам. Ошибку отдаём наружу: родитель покажет её плашкой.
 */
const addSetFromPanel = (section: PanelSectionItem): void => {
  const presetPackId = section.presetPackId
  if (presetPackId !== undefined) {
    presetBusyPackId.value = presetPackId
    void stickersStore
      .addPreset(presetPackId)
      .catch((cause: unknown) => {
        emit('sticker-error', getErrorMessage(cause, t('Не удалось добавить набор')))
      })
      .finally(() => {
        presetBusyPackId.value = null
      })
    return
  }
  const set = standardSetOf(section.key)
  if (!set) return
  void runSetImport(set).then((message) => {
    if (message) emit('sticker-error', message)
  })
}
/** Тап по картинке: уходит сообщением (стандартная — теми же байтами). */
const tapImage = (image: PanelImage) => {
  if (image.sticker) {
    stickersStore.rememberRecent(image.sticker.id)
    emit('send-sticker-image', {
      url: image.url,
      mime: image.sticker.mime_type ?? 'image/webp',
      pack: image.pack
    })
    return
  }
  emit('send-sticker-image', {
    url: image.url,
    mime: 'image/png',
    preset: image.preset
  })
}

/** Категории эмодзи со значком для ленты (без «Недавних» — он отдельно). */
const emojiCategorySections = computed<PanelSectionItem[]>(() =>
  emojiCategories.value.map((category) => ({
    key: `emoji:${category.key}`,
    title: category.title,
    kind: 'emoji-pick' as const,
    icon: category.icon,
    imageUrl: null,
    emojis: category.items,
    images: []
  }))
)

/** Секции панели эмодзи: недавние (если есть) и все категории. */
const emojiPanelSections = computed<PanelSectionItem[]>(() => [
  ...(emojiRecent.value.length
    ? [
        {
          key: 'emoji:recent',
          title: t('Недавние'),
          kind: 'emoji-pick' as const,
          icon: '🕒',
          imageUrl: null,
          emojis: emojiRecent.value,
          images: []
        }
      ]
    : []),
  ...emojiCategorySections.value
])

/** Секции панели стикеров: недавние, мои паки и «крупные» эмодзи. */
const stickerPanelSections = computed<PanelSectionItem[]>(() => [
  // Стандартные наборы приложения — первыми: они есть у всех и не требуют
  // ничего добавлять. Это наши картинки из `public/`, а не библиотека человека.
  ...STANDARD_STICKER_PACKS.map((pack) => {
    const images = standardImages(pack.key)
    return {
      key: `standard:${pack.key}`,
      title: pack.title,
      kind: 'sticker-send' as const,
      icon: '🎨',
      imageUrl: images[0]?.url ?? null,
      emojis: [],
      images
    }
  }),
  // Публичные (предустановленные) наборы с сервера: их ставит суперадмин, и
  // любой человек добавляет набор себе ОДНИМ запросом (файлы переиспользуются).
  // Свой же публичный набор не показываем — он уже есть ниже, среди своих паков.
  ...stickersStore.presets
    .filter((pack) => !stickersStore.packs.some((mine) => mine.title === pack.title))
    .map((pack) => ({
      key: `preset:${pack.id}`,
      title: pack.title,
      kind: 'sticker-send' as const,
      icon: '🎨',
      imageUrl: pack.stickers[0] ? mediaUrl(pack.stickers[0].file_url) : null,
      emojis: [],
      images: pack.stickers.map((sticker) => ({
        url: mediaUrl(sticker.file_url),
        alt: t('Стикер'),
        pack: { packId: pack.id, position: sticker.position }
      })),
      presetPackId: pack.id
    })),
  ...(stickersStore.recent.length
    ? [
        {
          key: 'sticker:recent',
          title: t('Недавние'),
          kind: 'sticker-send' as const,
          icon: '🕒',
          imageUrl: mediaUrl(stickersStore.recent[0]?.file_url ?? '') ?? null,
          emojis: [],
          images: stickersStore.recent.map(mediaImage)
        }
      ]
    : []),
  ...stickersStore.packs.map((pack) => ({
    key: `sticker:pack:${pack.id}`,
    title: pack.title,
    kind: 'sticker-send' as const,
    icon: '🖼️',
    imageUrl: pack.stickers[0] ? (mediaUrl(pack.stickers[0].file_url) ?? null) : null,
    emojis: [],
    images: pack.stickers.map((sticker) => ({
      ...mediaImage(sticker),
      pack: { packId: pack.id, position: sticker.position }
    })),
    emptyHint: t('В паке пусто. Добавьте картинки кнопкой «Добавить».')
  })),
  ...(emojiStickerRecent.value.length
    ? [
        {
          key: 'emoji-send:recent',
          title: t('Недавние эмодзи'),
          kind: 'emoji-send' as const,
          icon: '🕒',
          imageUrl: null,
          emojis: emojiStickerRecent.value,
          images: []
        }
      ]
    : []),
  ...emojiCategorySections.value.map((section) => ({
    ...section,
    kind: 'emoji-send' as const
  }))
])

/** Секции открытой панели (эмодзи или стикеров). */
const panelSections = computed<PanelSectionItem[]>(() =>
  props.extrasPanel === 'stickers' ? stickerPanelSections.value : emojiPanelSections.value
)

// ---------- Лента значков: переход к секции и подсветка текущей ----------
const panelScrollEl = ref<HTMLElement | null>(null)
const activeSection = ref<string>('')

// Элемент ленты отдаём composable целиком (`:ref="panelStrip.el"`): без привязки
// он работает «вслепую» — перетаскивание мышью и затухания краёв молча не делают
// ничего, и лента кажется непрокручиваемой.
const {
  edges: panelStripEdges,
  reveal: revealStripItem,
  refresh: panelStripRefresh,
  ...panelStrip
} = useHScroll(() => panelSections.value.length)

/** Отступ, при котором секция считается «текущей» (её заголовок у верха). */
const SECTION_ACTIVE_OFFSET = 12

/**
 * Тишина в событиях прокрутки = переход закончился.
 *
 * Фиксированная пауза тут не годится: плавная прокрутка длинной панели (в
 * каталоге эмодзи это тысячи пикселей) идёт заметно больше секунды, и если вернуть
 * подсветку раньше, она успевает проехаться по промежуточным категориям.
 */
const JUMP_QUIET_MS = 150

/**
 * Куда едет программная прокрутка (переход по ленте); `null` — панель двигает
 * человек.
 *
 * Пока едем, подсветку не пересчитываем: события прокрутки «пролистывают»
 * промежуточные категории, и активный значок мигал бы по пути.
 */
let jumpTargetTop: number | null = null
let jumpQuietTimer: ReturnType<typeof setTimeout> | undefined

/** Отменяет работу прошлого перехода, если тапнули по другому значку. */
let jumpSeq = 0

/**
 * Индекс последней секции, которую показываем не дожидаясь экрана (`PanelSection`
 * с `force`).
 *
 * Нужен для перехода по ленте: пока секции выше цели ленивые, их высота
 * неизвестна — посчитать позицию нельзя, и переход уезжал мимо (заголовок за
 * верхом, а у короткой группы и весь набор). Показываем всё до цели, считаем
 * позицию — и прокрутка встаёт ровно на заголовок; секции ниже остаются ленивыми.
 */
const forcedSectionsUpTo = ref(-1)

/** Активный значок держим на виду: лента длиннее, чем влезает в полосу. */
const centerActiveStripItem = () => revealStripItem('.panel-strip-item.active')

/**
 * Верх секции внутри контейнера прокрутки, в пикселях от начала содержимого.
 *
 * Считаем по прямоугольникам, а не через `offsetTop`: `offsetTop` отмеряется от
 * ближайшего позиционированного предка, а им для секций был `.extras-menu` — над
 * списком лежат вкладки «Эмодзи/Стикеры/GIF», полоса «Добавить/Паки» и лента
 * значков. Переход уезжал вниз ровно на их высоту: заголовок оставался за
 * верхом, а короткая группа («Недавние», небольшой пак) не попадала на экран.
 */
const sectionOffsetTop = (container: HTMLElement, section: HTMLElement): number =>
  section.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop

/** Секция на экране: последняя, чей верх уже дошёл до верха контейнера. */
const onPanelScroll = () => {
  const container = panelScrollEl.value
  if (!container) return
  if (jumpTargetTop !== null) {
    // Доехали — возвращаем подсветку к обычному расчёту по экрану.
    if (Math.abs(jumpTargetTop - container.scrollTop) <= 1) {
      jumpTargetTop = null
    } else {
      // Ещё едем (или встали там, куда смогли): ждём тишины в прокрутке.
      globalThis.clearTimeout(jumpQuietTimer)
      jumpQuietTimer = globalThis.setTimeout(() => {
        jumpTargetTop = null
        onPanelScroll()
      }, JUMP_QUIET_MS)
      return
    }
  }
  const sections = Array.from(container.querySelectorAll<HTMLElement>('[data-section]'))
  let current = panelSections.value[0]?.key ?? ''
  for (const section of sections) {
    if (sectionOffsetTop(container, section) <= container.scrollTop + SECTION_ACTIVE_OFFSET) {
      current = section.dataset.section ?? current
    } else {
      break
    }
  }
  if (current !== activeSection.value) {
    activeSection.value = current
    centerActiveStripItem()
  }
}

/**
 * Переход к секции по тапу в ленте (как в Telegram: значок = якорь).
 *
 * Ведём прокрутку самого контейнера (`scrollTo`), а не `scrollIntoView`: тот
 * прокручивает все вложенные контейнеры и мог дёрнуть сам список чатов.
 *
 * Секции до цели показываем заранее и только потом считаем позицию: ленивая
 * секция выше — это неотрисованное содержимое, то есть неизвестная высота,
 * из-за которой переход и уезжал.
 */
const jumpToSection = async (key: string) => {
  const container = panelScrollEl.value
  const index = panelSections.value.findIndex((section) => section.key === key)
  if (!container || index < 0) return
  const seq = ++jumpSeq
  activeSection.value = key
  forcedSectionsUpTo.value = index
  await nextTick()
  if (seq !== jumpSeq) return
  const target = container.querySelector<HTMLElement>(`[data-section="${key}"]`)
  if (!target) return
  centerActiveStripItem()
  jumpTargetTop = sectionOffsetTop(container, target)
  container.scrollTo({ top: jumpTargetTop, behavior: 'smooth' })
  // Первый «тик» перехода: если уже стоим на месте, закончим сразу, иначе
  // заведём отсчёт тишины (дальше его продлевают события прокрутки).
  onPanelScroll()
}

// Панель открыли или переключили — начинаем с начала и подсвечиваем первую секцию.
watch(
  () => props.extrasPanel,
  async (panel) => {
    if (panel !== 'emoji' && panel !== 'stickers') return
    // Незаконченный переход прошлой панели не должен тянуть прокрутку назад.
    jumpSeq += 1
    jumpTargetTop = null
    globalThis.clearTimeout(jumpQuietTimer)
    forcedSectionsUpTo.value = -1
    await nextTick()
    if (panelScrollEl.value) panelScrollEl.value.scrollTop = 0
    activeSection.value = panelSections.value[0]?.key ?? ''
    panelStripRefresh()
  }
)

/**
 * Панель доп. контента закрывают не только её кнопка: тап мимо панели и Escape
 * тоже — как в Телеграме. Иначе панель оставалась висеть поверх ленты, пока
 * человек не вспомнит про значок «смайлы», и закрыть её случайным тапом было
 * нельзя.
 *
 * Слушатели висят на документе только пока панель открыта (иначе они
 * перехватывали бы Escape у диалогов и клики по всей странице).
 */
const insideExtrasArea = (target: EventTarget | null): boolean => {
  const el = target instanceof Element ? target : null
  if (!el) return false
  // Сама панель и кнопка «смайлы» — её территория: кнопка переключает панель,
  // из неё же панель и открывают. Всё остальное (поле ввода, лента, шапка)
  // панель закрывает: тап по полю — это «буду печатать», и на телефоне за ним
  // поднимается клавиатура, как в Телеграме.
  return el.closest('.extras-menu') !== null || el.closest('.extras-toggle') !== null
}

const onDocumentPointerDown = (event: Event) => {
  // Окно паков открыто поверх панели — его клики панель не закрывают.
  if (stickerPacksOpen.value) return
  if (insideExtrasArea(event.target)) return
  emit('close-extras')
}

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  // Подсказку упоминаний закрывает само поле ввода — не гасим панель вместе с ней.
  if (mentionOpen.value) return
  emit('close-extras')
}

const stopWatchingExtrasDismiss = () => {
  globalThis.document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  globalThis.document.removeEventListener('keydown', onDocumentKeydown, true)
}

/**
 * Высоту панели отдаём родителю — лента резервирует под неё место снизу.
 *
 * Следим за размером, а не меряем один раз: содержимое секций монтируется
 * лениво (каталог эмодзи грузится динамическим импортом), и высота появляется
 * уже после первого кадра.
 */
const extrasMenuEl = ref<HTMLElement | null>(null)
let extrasResizeObserver: ResizeObserver | null = null

const reportExtrasHeight = () => {
  const el = extrasMenuEl.value
  emit('extras-height', el ? Math.round(el.getBoundingClientRect().height) : 0)
}

const stopExtrasHeightWatch = () => {
  extrasResizeObserver?.disconnect()
  extrasResizeObserver = null
}

const startExtrasHeightWatch = () => {
  stopExtrasHeightWatch()
  reportExtrasHeight()
  const el = extrasMenuEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  extrasResizeObserver = new ResizeObserver(reportExtrasHeight)
  extrasResizeObserver.observe(el)
}

const syncExtrasHeightWatch = async (panel: string) => {
  stopExtrasHeightWatch()
  if (panel === 'none') {
    emit('extras-height', 0)
    return
  }
  await nextTick()
  startExtrasHeightWatch()
}

watch(
  () => props.extrasPanel,
  (panel) => void syncExtrasHeightWatch(panel)
)

// Панель может быть открыта уже при появлении композера (смена чата с открытой
// панелью) — тогда наблюдатель за пропом не сработает.
onMounted(() => void syncExtrasHeightWatch(props.extrasPanel))

onBeforeUnmount(stopExtrasHeightWatch)

// ---------- Жесты и клавиатура внутри панели ----------

/** Свайп вниз по панели её закрывает (телефон), как жест «убрать клавиатуру». */
const PANEL_SWIPE_CLOSE_PX = 60
const panelSwipeOffset = ref(0)
let panelTouchStartY: number | null = null
let panelTouchStartScrollTop = 0

/** Захват начинаем, только если жест не отнимает прокрутку у списка секций. */
const onPanelTouchStart = (event: TouchEvent) => {
  const touch = event.touches[0]
  if (!touch) return
  const scroll = panelScrollEl.value
  panelTouchStartScrollTop = scroll?.scrollTop ?? 0
  panelTouchStartY = touch.clientY
  panelSwipeOffset.value = 0
}

const onPanelTouchMove = (event: TouchEvent) => {
  const touch = event.touches[0]
  if (panelTouchStartY === null || !touch) return
  const delta = touch.clientY - panelTouchStartY
  // Вверх (прокрутка содержимого) не наш жест; вниз при прокрученном списке —
  // человек читает дальше, а не закрывает панель.
  if (delta <= 0 || (panelTouchStartScrollTop > 0 && panelScrollEl.value?.scrollTop !== 0)) {
    panelSwipeOffset.value = 0
    return
  }
  // Панель тянется за пальцем, но не дальше половины своей высоты.
  panelSwipeOffset.value = Math.min(delta, 160)
}

const onPanelTouchEnd = () => {
  const offset = panelSwipeOffset.value
  panelTouchStartY = null
  panelSwipeOffset.value = 0
  if (offset >= PANEL_SWIPE_CLOSE_PX) emit('close-extras')
}

/**
 * Стрелки и Tab в панели не перехватываем: приложение мобильное, панель
 * проходится пальцем и прокруткой, а перехват стрелок только мешал бы
 * прокрутке панели с клавиатуры.
 */
watch(
  () => props.extrasPanel,
  (panel) => {
    stopWatchingExtrasDismiss()
    if (panel === 'none') return
    globalThis.document.addEventListener('pointerdown', onDocumentPointerDown, true)
    globalThis.document.addEventListener('keydown', onDocumentKeydown, true)
  }
)

// Панель может быть открыта уже при появлении композера — тогда наблюдатель за
// пропом не сработает.
onMounted(() => {
  if (props.extrasPanel === 'none') return
  globalThis.document.addEventListener('pointerdown', onDocumentPointerDown, true)
  globalThis.document.addEventListener('keydown', onDocumentKeydown, true)
})

onBeforeUnmount(stopWatchingExtrasDismiss)

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
const emojiStickerRecent = ref<string[]>(readRecentStickers(globalThis.localStorage))

/** Пак, в который уйдёт загрузка: первый пак человека (если он есть). */
const uploadPackId = computed<number | null>(() => stickersStore.packs[0]?.id ?? null)

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
          // Запасной текст — имя файла: в пачке понятно, какой именно не прошёл.
          failed.push(getErrorMessage(cause, file.name))
        }
      }
      if (failed.length) {
        emit('sticker-error', t('Не добавились: {list}', { list: failed.join('; ') }))
        return
      }
    } catch (cause) {
      emit('sticker-error', getErrorMessage(cause, t('Не удалось добавить стикер')))
    }
  })()
}

const emit = defineEmits<{
  (e: 'send-text'): void
  /**
   * Файлы выбраны: `viewOnce` — «посмотреть один раз» (медиа сгорает).
   *
   * Идёт ПАЧКА, а не один файл: подряд идущие картинки собираются в альбом
   * (сетка в ленте, см. `utils/albums.ts`), и отправлять их нужно одним
   * действием, иначе родитель получил бы несколько независимых вызовов.
   */
  (e: 'files-selected', files: File[], viewOnce?: boolean): void
  (e: 'cancel-edit'): void
  (e: 'clear-reply'): void
  (e: 'voice-cancel'): void
  (e: 'voice-send', payload: RecordedMedia): void
  (e: 'mic-down'): void
  (e: 'mic-up'): void
  (e: 'mic-cancel'): void
  (e: 'mic-click'): void
  (e: 'toggle-extras'): void
  /** Закрыть панель доп. контента (клик мимо, Escape) — панель живёт у родителя. */
  (e: 'close-extras'): void
  /** Человек закрыл плашку ошибки крестиком. */
  (e: 'dismiss-error'): void
  /** Нажал «Повторить» в плашке ошибки отправки. */
  (e: 'retry-error'): void
  /**
   * Высота открытой панели доп. контента в пикселях (0 — панель закрыта).
   * Родитель резервирует под неё место в ленте: панель рисуется поверх неё.
   */
  (e: 'extras-height', height: number): void
  (e: 'set-extras-tab', tab: 'emoji' | 'stickers' | 'gif'): void
  (e: 'gif-sent'): void
  (e: 'append-emoji', emoji: string): void
  /** Стикер-эмодзи: отправить сразу отдельным сообщением. */
  (e: 'send-sticker', sticker: string): void
  /**
   * Стикер-картинка: отправить её как сообщение (kind='sticker').
   *
   * Передаём готовую ссылку и тип: у своих стикеров это файл с сервера, у
   * стандартных — статический ассет приложения. Родителю разница не важна.
   */
  (
    e: 'send-sticker-image',
    payload: {
      url: string
      mime: string
      /** Встроенный набор приложения: метка `st-…` в имени файла. */
      preset?: { setKey: string; name: string }
      /** Пак на сервере: метка `sp-<id>-…` в имени файла. */
      pack?: { packId: number; position: number }
    }
  ): void
  /** Сообщение об ошибке добавления стикера (показывает родитель). */
  (e: 'sticker-error', message: string): void
  /** «Отправить позже»: момент отправки в UTC (ISO), текст берёт родитель. */
  (e: 'send-scheduled', sendAt: string): void
}>()

const attachInput = ref<HTMLInputElement | null>(null)
/** Меню у кнопки вложения: обычный файл или «посмотреть один раз». */
const attachMenuOpen = ref(false)
/** Выбранный режим отправки: true — одноразовое медиа (фото/видео). */
const viewOncePick = ref(false)

/** Открывает выбор файла в нужном режиме (без режима «одноразово» — любой файл). */
const pickAttachment = (viewOnce: boolean) => {
  viewOncePick.value = viewOnce
  attachMenuOpen.value = false
  attachInput.value?.click()
}

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  // Одноразовым может быть только медиа: «сгорающий» документ/архив смысла не
  // имеет, а в списке файлов он бы потом искался. В режиме «одноразово» выбор
  // и так ограничен картинками и видео (`accept`), поэтому решаем по пачке.
  const allMedia = files.every(
    (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
  )
  const viewOnce = viewOncePick.value && allMedia
  viewOncePick.value = false
  emit('files-selected', files, viewOnce)
}

// ---------- Отправить позже ----------
// Меню живёт на самой кнопке отправки: обычный клик отправляет, удержание (на
// телефоне) или правая кнопка (на компьютере) — предлагает время. Отдельной
// кнопки нет: она бы дублировала основную и занимала место в строке ввода.

/** Меню «отправить позже» и его пункты (считаются при каждом открытии). */
const scheduleMenuOpen = ref(false)
const scheduleOptions = ref<SchedulePreset[]>([])

/** Сколько держать кнопку отправки, чтобы открылось меню времени. */
const SCHEDULE_HOLD_MS = 450
let scheduleHoldTimer: ReturnType<typeof setTimeout> | null = null
/** Меню открылось удержанием — следующий клик отправлять не должен. */
let scheduleHoldHandled = false

/** Заполняет варианты времени заново: пункты зависят от текущего часа. */
const openScheduleMenu = () => {
  scheduleOptions.value = schedulePresets()
  scheduleMenuOpen.value = scheduleOptions.value.length > 0
}

const cancelScheduleHold = () => {
  if (scheduleHoldTimer !== null) {
    clearTimeout(scheduleHoldTimer)
    scheduleHoldTimer = null
  }
}

const startScheduleHold = () => {
  scheduleHoldHandled = false
  cancelScheduleHold()
  scheduleHoldTimer = setTimeout(() => {
    scheduleHoldHandled = true
    openScheduleMenu()
  }, SCHEDULE_HOLD_MS)
}

/** Клик по кнопке отправки: после удержания он только закрывает меню. */
const onSendClick = () => {
  if (scheduleHoldHandled) {
    scheduleHoldHandled = false
    return
  }
  emit('send-text')
}

/** Выбрали время — отдаём момент отправки родителю (текст он берёт сам). */
const pickSchedule = (preset: SchedulePreset) => {
  scheduleMenuOpen.value = false
  emit('send-scheduled', scheduledSendAt(preset.at))
}

onBeforeUnmount(cancelScheduleHold)

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
        emit('files-selected', [file])
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

// ---------- Развёрнутый ввод на весь экран (телефон) ----------
/**
 * Поле ввода развёрнуто на весь экран.
 *
 * Зачем: на телефоне строка ввода узкая, и форматирование («Aa») в ней теснило
 * поле. Теперь дополнительные кнопки живут только в развёрнутом режиме —
 * панелью сверху, а в обычной строке их нет (как в Телеграме): формат там
 * предлагает панель по выделению (`.selection-menu`).
 */
const expanded = ref(false)

/** Развернуть: фокус возвращаем в поле, иначе клавиатура закроется на нажатии. */
const expand = () => {
  expanded.value = true
  void nextTick(() => {
    const el = textInputRef.value
    if (el) el.style.height = ''
    el?.focus({ preventScroll: true })
  })
}

/** Свернуть и вернуть полю обычную высоту (авторост). */
const collapse = () => {
  expanded.value = false
  void nextTick(autoGrow)
}

/** Кнопка в строке — переключатель: развернуть / свернуть. */
const toggleExpand = () => {
  if (expanded.value) collapse()
  else expand()
}

// ---------- Формат текста (кнопка «Aa» в развёрнутом вводе) ----------
/** Меню формата открыто (кнопка «Aa»). */
const formatMenuOpen = ref(false)

/** Что предлагает меню: подписи — ключи перевода (см. `i18n/en.ts`). */
const MARKUP_ITEMS: readonly { kind: MarkupKind; label: string }[] = [
  { kind: 'bold', label: 'Жирный' },
  { kind: 'italic', label: 'Курсив' },
  { kind: 'underline', label: 'Подчёркнутый' },
  { kind: 'strike', label: 'Зачёркнутый' },
  // Цитата — не обрамление, а знак `> ` в начале каждой строки (см. applyQuote).
  { kind: 'quote', label: 'Цитата' },
  { kind: 'code', label: 'Код' },
  { kind: 'spoiler', label: 'Спойлер' }
]

/**
 * Обернуть выделение знаками разметки (или снять их) — и вернуть выделение.
 *
 * Работает с той же парой индексов, что и подсказка упоминаний, поэтому
 * восстановление выделения делаем по тем же правилам: сначала новый текст,
 * потом фокус и `setSelectionRange` в `nextTick`.
 */
const applyFormat = (kind: MarkupKind) => {
  const input = textInputRef.value
  const start = input?.selectionStart ?? newMessage.value.length
  const end = input?.selectionEnd ?? start
  const next = applyMarkup(newMessage.value, start, end, kind)
  newMessage.value = next.text
  formatMenuOpen.value = false
  /* Правка сама ставит выделение заново (`setSelectionRange`): без глушения
     панель формата тут же открылась бы снова и закрывала поле. */
  suppressSelectionMenu = true
  void nextTick(() => {
    input?.focus()
    input?.setSelectionRange(next.start, next.end)
    closeSelectionMenu()
    autoGrow()
    globalThis.setTimeout(() => {
      suppressSelectionMenu = false
    }, 0)
  })
}

// ---------- Формат по выделению (обычная строка) ----------
/**
 * Панель формата над полем по выделению.
 *
 * Кнопки «Aa» в обычной строке нет (теснила поле ввода), но сам формат нужен —
 * поэтому знаки разметки предлагаются там, где они и применяются: как только в
 * поле что-то выделили (владелец, 29.09.2026).
 */
const selectionMenuOpen = ref(false)

/** Выделение меняет сам код (`applyFormat`) — панель тогда не переоткрываем. */
let suppressSelectionMenu = false

/** Сама панель: нужна, чтобы измерить её габарит перед постановкой. */
const selectionMenuEl = ref<HTMLElement | null>(null)

/** Координаты панели — считает `placeSelectionMenu` по положению выделения. */
const selectionMenuStyle = ref<Record<string, string> | undefined>(undefined)

/** Где в поле выделение (координаты от левого верхнего угла поля). */
const selectionBox = ref<CaretBox | null>(null)

/** Отступ панели от строки выделения. */
const SELECTION_MENU_GAP = 8

/**
 * Поставить панель рядом с выделением.
 *
 * Ширину и высоту панели берём у неё самой: подписи разной длины, и на узком
 * экране она переносится на вторую строку. Поэтому сначала отрисовка, потом
 * замер и только потом координаты (`nextTick`).
 */
const placeSelectionMenu = () => {
  const el = textInputRef.value
  const box = selectionBox.value
  if (!el || !box) {
    selectionMenuStyle.value = undefined
    return
  }
  const panel = {
    width: selectionMenuEl.value?.offsetWidth ?? 0,
    height: selectionMenuEl.value?.offsetHeight ?? 0
  }
  const anchor = menuAnchor(
    box,
    panel,
    // Высота поля — из замера, а верх — от верха ОКНА: панель всплывает над
    // лентой, и место над ней считаем до края экрана, а не до поля.
    // В развёрнутом вводе поле занимает панель целиком — там места над полем нет
    // вовсе, поэтому верхом считаем сам верх поля.
    {
      width: el.clientWidth,
      top: expanded.value ? 0 : el.getBoundingClientRect().top
    },
    SELECTION_MENU_GAP
  )
  selectionMenuStyle.value = {
    left: `${anchor.left}px`,
    top: `${anchor.top}px`,
    transform: anchor.above
      ? `translate(-50%, calc(-100% - ${SELECTION_MENU_GAP}px))`
      : `translate(-50%, ${SELECTION_MENU_GAP}px)`
  }
}
/**
 * Показать/спрятать панель по текущему выделению.
 *
 * Зовут её события поля (`select`, `pointerup`, `keyup`) и `selectionchange`
 * документа: на телефоне выделение тянут за «ушки», и события самого поля при
 * этом не приходят.
 */
const syncSelectionMenu = () => {
  const el = textInputRef.value
  if (!el || suppressSelectionMenu || document.activeElement !== el) {
    selectionMenuOpen.value = false
    selectionBox.value = null
    selectionMenuStyle.value = undefined
    return
  }
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const open = end > start
  selectionMenuOpen.value = open
  if (!open) {
    selectionBox.value = null
    selectionMenuStyle.value = undefined
    return
  }
  selectionBox.value = caretBox(el, start)
  void nextTick(placeSelectionMenu)
}

/** Спрятать панель: поле потеряло фокус, текст изменился и т. п. */
const closeSelectionMenu = () => {
  selectionMenuOpen.value = false
  selectionBox.value = null
  selectionMenuStyle.value = undefined
}

onMounted(() => document.addEventListener('selectionchange', syncSelectionMenu))
onBeforeUnmount(() => document.removeEventListener('selectionchange', syncSelectionMenu))

const onTextInput = () => {
  autoGrow()
  updateMentions()
}

// Закрываем подсказку при выходе из режима ввода/смене чата.
watch(
  () => [props.chatId, props.editingMessage?.id] as const,
  () => {
    mentionOpen.value = false
    // Чат сменился — развёрнутый ввод закрываем: в новом чате он бы остался
    // висеть вместо ленты, а текст в поле уже другой.
    expanded.value = false
  }
)

// Началась запись голосового/кружка — раскладка развёрнутого ввода не нужна.
watch(
  () => props.voiceRecOpen,
  (open) => {
    if (open) expanded.value = false
  }
)

// ---------- Авто-рост многострочного поля ----------
const textInputRef = ref<HTMLTextAreaElement | null>(null)
/** Максимальная высота поля ввода (пикселей) — примерно 6 строк. */
const TEXTAREA_MAX_HEIGHT = 140

/** С какой строки показываем значок разворота (одно-двухстрочное поле не растёт). */
const MULTILINE_MIN_LINES = 3

/**
 * Текст занимает три строки и больше: только тогда в строке нужен значок
 * разворота, а полю — место под него справа (`.multiline` в CSS).
 */
const multiline = ref(false)

/** Сколько строк занимает текст в поле — по высоте содержимого, а не по переносам. */
const countLines = (el: HTMLTextAreaElement): number => {
  const style = getComputedStyle(el)
  const lineHeight = Number.parseFloat(style.lineHeight)
  const padding =
    Number.parseFloat(style.paddingTop || '0') + Number.parseFloat(style.paddingBottom || '0')
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 1
  return Math.max(1, Math.round((el.scrollHeight - padding) / lineHeight))
}

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
  // В развёрнутом режиме высоту задаёт раскладка (поле занимает экран):
  // инлайновая высота от автороста его бы только сжала.
  if (expanded.value) {
    el.style.height = ''
    return
  }
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
  // Значок разворота — только когда текста на три строки (иначе он закрывал
  // строку, а разворачивать в ней было нечего).
  multiline.value = countLines(el) >= MULTILINE_MIN_LINES
}

// Сброс высоты при очистке/подстановке текста (например, после отправки).
watch(newMessage, () => {
  // Текст изменился — прежнее выделение устарело, панель формата прячем.
  closeSelectionMenu()
  void nextTick(autoGrow)
})

// Развёрнутый ввод — слой общего стека: на телефоне «назад» сворачивает поле,
// а не выходит из приложения (как и любая другая панель поверх экрана).
useMobileLayer(
  () => expanded.value,
  () => collapse()
)
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

/* Плашка ошибки — общий компонент (ErrorNotice), здесь только отступ до строки
   ввода: свою геометрию он приносит с собой. */
.input-area :deep(.error-notice) {
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
  border-radius: var(--ms-radius-sm);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  z-index: 12;
  animation: record-hint-pop var(--ms-dur-fast) var(--ms-ease);
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
  border-radius: var(--ms-radius-xs);
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
  /* Полная «пилюля» — как в Телеграме: строка ввода самое заметное поле в
     приложении, а скругление 14px при высоте 48 читалось как прямоугольник. */
  border-radius: var(--ms-radius-pill);
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

/* Ячейка «микрофон ↔ отправка»: одна кнопка на двоих. Так кнопка записи
   «перетекает» в отправку на том же месте (как в Telegram), а не подменяется
   мгновенно. */
.action-slot {
  position: relative;
  display: inline-flex;
}

/* Зазор перед ячейкой зависит от того, что в ней видно: у ЗАЛИТОЙ отправки
   граница — сам круг (пустоты по бокам нет), у контурного микрофона — глиф
   шириной 14 px. Поэтому компенсация стоит на обёртках, а не на ячейке: иначе
   в одном из двух состояний просвет был бы больше остальных (замер по пикселам:
   16 px у отправки против 28 px у микрофона). */
.mic-wrap {
  margin-left: -2px;
}

/* Кнопка отправки вместе со своим меню «отправить позже» */
.send-wrap {
  position: relative;
  display: inline-flex;
  margin-left: 6px;
}

/* Появление отправки (текст набрали) — та же «выпрыгивающая» анимация, что была
   у обёртки: теперь её держит enter-класс перехода, чтобы не играть дважды. */
.action-morph-enter-active {
  animation: send-pop 0.18s var(--ms-ease);
}

/* Уход микрофона: кнопка «сжимается» на месте. Уходящий кадр вынимаем из потока
   (position: absolute) — иначе на время перехода в строке стояли бы две кнопки и
   поле ввода прыгало бы влево. */
.action-morph-leave-active {
  position: absolute;
  top: 0;
  right: 0;
  animation: mic-morph-out var(--ms-dur-fast) var(--ms-ease) forwards;
}

@keyframes mic-morph-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.7);
  }
}

@keyframes send-pop {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* Отправка — тот же габарит, что у соседних круглых кнопок (32 px), иначе её
   значок стоит дальше от смайла и ряд выглядит неровным. */
.send-btn {
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
}

/* Нажатие отзывается сжатием: на телефоне палец попадает по кнопке — она должна
   подтвердить нажатие до отправки (запрос уходит не мгновенно). */
.send-btn:active {
  transform: scale(0.9);
}

.send-btn:hover {
  background: var(--ms-accent-strong);
}

/* Телефон: у всех кнопок строки один габарит — 38 px, как в общем слое.
   Отправку 40 px делали «главнее», но тогда её значок стоял дальше от соседей
   и ряд был неровным (просьба владельца: выровнять по расстоянию). */
@media (max-width: 600px) {
  .send-btn {
    width: 38px;
    height: 38px;
  }
}

.hidden-file {
  display: none;
}

/* Кнопка вложения вместе со своим меню */
.attach-wrap {
  position: relative;
  display: inline-flex;
}

/* Поле со значком разворота внутри: значок позиционируется от этой обёртки.
   Обёртка одна на поле, поэтому ширина текста не меняется от кнопок. */
.editor-slot {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
}

/* Кнопки справа от поля — одной обёрткой: в развёрнутом вводе они собираются в
   тесный ряд под полем, а не разъезжаются по краям экрана. Отступы те же, что
   были у строки, поэтому обычный вид не меняется. */
.input-tools {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Кнопка формата: буквы вместо значка — глифа «Aa» в наборе иконок нет, а
   текстом он читается сразу и не требует пересборки шрифта. */
.format-wrap {
  position: relative;
  display: inline-flex;
  /* Текст «Aa» у́же соседних значков: компенсируем по 2 px с боков, иначе глазу
     видно больше пустоты вокруг него (замер по пикселам). */
  margin: 0 -2px;
}

.format-btn {
  font-size: var(--ms-fs-sm);
  font-weight: 700;
  line-height: 1;
}

/* Меню формата: знаки разметки для выделенного куска */
.format-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ms-space-1);
  min-width: 190px;
}

/* Панель формата по выделению (обычная строка): кнопки «Aa» там нет, поэтому
   знаки разметки предлагаются рядом с выделением — координаты (`left`/`top`)
   считает `placeSelectionMenu` по замеру каретки. По центру поля её ставить
   нельзя: в вебе поле во всю ширину, и панель улетала в центр мессенджера,
   далеко от выделенного текста (владелец, 29.09.2026).
   Подложка/рамка/тень — общий слой `.ms-pop` (`assets/appearance.css`). */
.selection-menu {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px;
  max-width: min(280px, calc(100vw - 28px));
  padding: 4px;
  --ms-pop-radius: var(--ms-radius-md);
}

.selection-item {
  padding: 7px 9px;
  border: none;
  border-radius: var(--ms-radius-sm);
  background: transparent;
  color: var(--ms-text-strong);
  font: inherit;
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.selection-item:hover {
  background: var(--ms-hover);
  color: var(--ms-accent);
}

/* Подпись пункта — тем же видом, какой получит текст: выбирать «Зачёркнутый»,
   примеряя, что это значит, не нужно (владелец, 29.09.2026). Класс общий для
   обоих меню: «Aa» в развёрнутом вводе и панель по выделению. */
.markup-item.kind-bold {
  font-weight: 700;
}

.markup-item.kind-italic {
  font-style: italic;
}

.markup-item.kind-underline {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markup-item.kind-strike {
  text-decoration: line-through;
}

.markup-item.kind-code {
  font-family: var(--ms-font-mono);
  font-size: 0.92em;
  background: var(--ms-mark-bg);
  border-radius: var(--ms-radius-xs);
}

/* Цитата — с полосой слева: ровно то, что появится в сообщении. */
.markup-item.kind-quote {
  border-left: 3px solid var(--ms-accent);
  border-radius: 0;
  padding-left: 8px;
}

/* Спойлер закрыт, пока на него не навели: так он читается как результат.
   На тач-устройствах наведения нет — там подпись видна сразу, иначе пункт
   меню остался бы загадкой. */
@media (hover: hover) {
  .markup-item.kind-spoiler {
    filter: blur(3.5px);
    user-select: none;
  }

  .markup-item.kind-spoiler:hover {
    filter: none;
  }
}

/* Меню вложения: обычный файл или одноразовое медиа */
.attach-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ms-space-1);
  min-width: 210px;
}

.attach-item {
  display: flex;
  align-items: center;
  gap: var(--ms-space-2);
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--ms-radius-sm);
  background: transparent;
  color: var(--ms-text);
  font-family: var(--ms-font), sans-serif;
  font-size: var(--ms-fs-base);
  text-align: left;
  cursor: pointer;
}

.attach-item:hover {
  background: var(--ms-hover);
}

.attach-hint {
  margin: var(--ms-space-1) var(--ms-space-2) var(--ms-space-2);
  color: var(--ms-muted);
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
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
  /* Подложка, рамка и тень — общий слой `.ms-pop` (`assets/appearance.css`). */
  --ms-pop-radius: var(--ms-radius-lg);
  padding: 6px;
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--ms-radius-sm);
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
  border-radius: var(--ms-radius-lg);
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
  border-radius: var(--ms-radius-sm);
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

/* Панели доп.контента (как в Telegram): лента значков сверху, содержимое —
   столбиком по секциям. Лента даёт быстрый переход, столбик — видно всё. */
.media-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.panel-strip::-webkit-scrollbar {
  display: none;
}

.panel-strip-item {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  /* Рамка есть всегда, меняется только её цвет: иначе значок при выборе
     дёргается на пиксель и «прыгает» в ленте. */
  border: 1px solid transparent;
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
  font-size: var(--ms-fs-lg);
  line-height: 1;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.panel-strip-item img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.panel-strip-item.active {
  background: var(--ms-accent-soft);
  border-color: var(--ms-accent-border);
}

.panel-scroll {
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  border-radius: var(--ms-radius-sm);
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
  border-radius: var(--ms-radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Кнопка набора под сеткой стикеров — как «ДОБАВИТЬ СТИКЕРЫ» в Телеграме.
   Оформлена как элементы этой же панели (активная вкладка, значок ленты):
   акцентная подложка, акцентная рамка, скругление панели. Она одна: и действие,
   и его ход видно сразу (см. `setAddStateOf`). */
.set-add-wide {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--ms-space-1);
  width: 100%;
  margin-top: var(--ms-space-2);
  padding: 8px 10px;
  border: 1px solid var(--ms-accent-border);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
  font: inherit;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--ms-dur-fast) var(--ms-ease);
}

.set-add-wide:hover:not(:disabled) {
  border-color: var(--ms-accent);
}

/* Идёт добавление: кнопка не нажимается, но остаётся акцентной — серых
   «выключенных» плашек в панели нет, подпись сама говорит, что происходит. */
.set-add-wide:disabled {
  cursor: default;
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
  /* Внутри группы зазор был такой же, как у строки: на узком экране он тоже 6. */
  .input-tools {
    gap: 6px;
  }
  /* Размер кнопок здесь НЕ уменьшаем: 30 px для пальца мало (общий телефонный
     размер — 38 px в appearance.css), а зазор 2 px превращал промах в нажатие
     по соседней кнопке. */
}

/* ---------- Развёрнутый ввод (телефон) ---------- */

/* Значок разворота — только на телефоне и только у текста на три строки и
   больше (`.multiline`, см. `autoGrow`): в вебе строка остаётся как была, а на
   низком поле значок закрывал текст, хотя разворачивать там нечего.
   Живёт внутри поля у правого края (позиционируется от `.editor-slot`),
   поэтому не отнимает у текста отдельную кнопку. Габарит и значок — как у
   соседних кнопок: у двойной стрелки чернила вдвое у́же, и зазор до смайла
   выглядел вдвое больше остальных. */
.field-toggle {
  display: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 38px;
  height: 38px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--ms-icon-2);
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

@media (max-width: 600px) {
  /* Значки в строке — с ОДИНАКОВЫМ зазором 2 px и одного габарита: разные
     размеры кнопок и зазоры (6/8 px) читались как «не ровно» и «далеко». */
  .input-row,
  .input-tools {
    gap: 2px;
  }

  /* Отправка — тот же круг 38 px, что у соседей (см. выше): при 40 px её значок
     стоял дальше от смайла. */

  /* Значок разворота — только у текста на три строки и больше: на низком поле
     он закрывал текст, а разворачивать там было нечего (`.multiline` считает
     `autoGrow`). */
  .input-area.multiline .field-toggle {
    display: inline-flex;
  }

  .field-toggle {
    /* Зазор до смайла — как у остальных значков: у шеврона чернила вдвое у́же
       (10 px против 19), поэтому его сдвигаем вправо на 4 px — иначе глазу
       видно, что от значка разворота до смайла больше, чем до отправки. */
    right: -4px;
  }

  /* Прижимаем значки плотнее (замер по пикселам: было 22 px просвета — стало
     17–18). Сдвиги разные, потому что «чернила» у кнопок разной ширины: у текста
     «Aa» — 14 px, у шеврона — 10, у микрофона — 14, а у залитой отправки — весь
     круг (38 px). Полю от этого достаётся лишние ~5 px, а просветы одинаковые. */
  .extras-toggle {
    margin-left: -5px;
  }

  .format-wrap {
    margin-left: -6px;
    margin-right: 0;
  }
  .mic-wrap {
    margin-left: -8px;
  }

  .send-wrap {
    margin-left: 4px;
  }

  /* Место под значок в поле: текст под него не заезжает (значок появляется
     только у многострочного текста — см. `.multiline`). */
  .input-area.multiline .text-input {
    padding-right: 40px;
  }
}

/* Развёрнутое поле накрывает панель чата (шапку и ленту): `inset: 0` считается
   от `.chat-panel` — она уже `position: relative`. Слой ВЫШЕ ленты и её кнопки
   «вниз» (`.jump-btn`, z-index 5): та висела ровно поверх отправки. */
.input-area.expanded {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
}

/* Развёрнутый ввод: поле занимает всю панель, кнопки уходят вниз и собираются
   в тесную группу у правого края (раньше разъезжались по краям экрана —
   скрепка слева, отправка справа, а между ними пустота). */
.input-area.expanded .input-row {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr auto auto;
  grid-template-rows: minmax(0, 1fr) auto;
  /* По горизонтали — тот же ровный зазор 2 px, что и в обычной строке; по
     вертикали больше, иначе поле липнет к кнопкам. */
  column-gap: 2px;
  row-gap: 6px;
  align-items: end;
  border-radius: var(--ms-radius-lg);
  padding: 8px 10px;
}

.input-area.expanded .editor-slot {
  grid-column: 1 / -1;
  grid-row: 1;
  /* Строка сетки выравнивает по низу (кнопки), полю же нужна вся высота. */
  align-self: stretch;
}

.input-area.expanded .text-input {
  max-height: none;
}

/* Верхняя строка развёрнутого ввода: «свернуть» в самом верху панели, подальше
   от кнопки отправки. */
.expand-bar {
  display: flex;
  justify-content: flex-end;
}

/* В развёрнутом виде значок в поле не нужен — «свернуть» уже есть сверху. */
.input-area.expanded .field-toggle {
  display: none;
}

.input-area.expanded .attach-wrap {
  grid-column: 2;
  grid-row: 2;
}

.input-area.expanded .input-tools {
  grid-column: 3;
  grid-row: 2;
}
</style>
