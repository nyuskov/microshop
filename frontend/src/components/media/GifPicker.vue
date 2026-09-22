<template>
  <div class="gif-picker" @mousedown.self="nothing">
    <div class="gif-picker-inner" @click.stop>
      <div class="gif-head">
        <q-icon :name="icon('search')" class="gif-search-icon" size="17px" />
        <input
          v-model="query"
          class="gif-search-input"
          type="text"
          :placeholder="t('Поиск GIF…')"
          @keydown.enter.prevent="doSearch()"
        />
        <button class="gif-search-btn" :disabled="loading" :title="t('Найти')" @click="doSearch()">
          <q-icon :name="icon('arrow_forward')" size="18px" />
        </button>
      </div>

      <div
        ref="chipsEl"
        class="gif-chips"
        :class="{ 'fade-start': chipsEdges.start, 'fade-end': chipsEdges.end }"
        @scroll.passive="refreshChipsEdges"
        @wheel.passive="onChipsWheel"
        @pointerdown="onChipsPointerDown"
        @pointermove="onChipsPointerMove"
        @pointerup="onChipsPointerUp"
        @pointerleave="onChipsPointerUp"
        @pointercancel="onChipsPointerUp"
      >
        <button class="gif-chip" :class="{ active: !query.trim() }" @click="loadTrending()">
          {{ t('Тренды') }}
        </button>
        <button
          v-for="chip in QUICK_QUERIES"
          :key="chip"
          class="gif-chip"
          :class="{ active: query.trim() === chip }"
          @click="doSearch(chip)"
        >
          {{ chip }}
        </button>
      </div>

      <div v-if="!keyAvailable" class="gif-status">
        Не задан ключ Giphy. Добавьте <b>VITE_GIPHY_API_KEY</b> {{ t('в файл') }}
        <b>frontend/.env</b> (см. .env.example) и перезапустите frontend.
      </div>
      <div v-else-if="loading" class="gif-status">
        <span class="gif-spinner"></span> {{ t('Загрузка…') }}
      </div>
      <div v-else-if="error" class="gif-status error">{{ error }}</div>
      <div v-else-if="!results.length" class="gif-status">{{ t('Ничего не найдено') }}</div>
      <div v-else class="gif-grid">
        <button
          v-for="gif in results"
          :key="gif.id"
          class="gif-tile"
          :disabled="sendingId !== null"
          :title="t('Отправить GIF')"
          @click="sendGif(gif)"
        >
          <img :src="gif.preview" :alt="gif.title || 'GIF'" loading="lazy" decoding="async" />
          <span v-if="sendingId === gif.id" class="gif-tile-loading">
            <span class="gif-spinner"></span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { onMounted, ref } from 'vue'
import { sendGifMessage } from '@/services/chatService'
import { useHScroll } from '@/composables/useHScroll'
import { fetchTrendingGifs, hasGiphyKey, searchGifs, type GiphyGif } from '@/services/giphy'
import { t } from '@/i18n'

const props = defineProps<{
  chatId: number
  replyToId?: number | null
  /**
   * Комментарий к гифке — текст из поля ввода. Тап по гифке в Телеграме
   * отправляет её сразу, поэтому «написать подпись после» нельзя: берём то,
   * что человек уже напечатал (пусто — гифка без подписи).
   */
  caption?: string
}>()

// Событие «sent» — это подтверждение постановки задачи: сообщение появится в
// ленте чуть позже, когда фоновый воркер скачает GIF и web пришлёт message.new.
const emit = defineEmits<{
  (e: 'sent'): void
}>()

const QUICK_QUERIES = ['😀', 'кот', 'привет', 'спасибо', 'праздник', 'круто']

/** Быстрые запросы — тоже лента: на телефоне она не влезает целиком, а в
 *  веб-версии без прокрутки до правого края было не добраться. */
const {
  el: chipsEl,
  edges: chipsEdges,
  refresh: refreshChipsEdges,
  onWheel: onChipsWheel,
  onPointerDown: onChipsPointerDown,
  onPointerMove: onChipsPointerMove,
  onPointerUp: onChipsPointerUp
} = useHScroll(() => QUICK_QUERIES.length)

const keyAvailable = hasGiphyKey()
const query = ref('')
const results = ref<GiphyGif[]>([])
const loading = ref(false)
const error = ref('')
const sendingId = ref<string | null>(null)

const loadTrending = async () => {
  query.value = ''
  loading.value = true
  error.value = ''
  try {
    results.value = await fetchTrendingGifs()
  } catch {
    error.value = 'Не удалось загрузить гифки'
  } finally {
    loading.value = false
  }
}

const doSearch = async (chip?: string) => {
  if (chip !== undefined) query.value = chip
  loading.value = true
  error.value = ''
  try {
    results.value = query.value.trim() ? await searchGifs(query.value) : await fetchTrendingGifs()
  } catch {
    error.value = 'Не удалось найти гифки'
  } finally {
    loading.value = false
  }
}

const sendGif = async (gif: GiphyGif) => {
  if (sendingId.value) return
  sendingId.value = gif.id
  error.value = ''
  try {
    await sendGifMessage(props.chatId, gif.gif, props.replyToId ?? null, props.caption ?? '')
    emit('sent')
  } catch {
    error.value = 'Не удалось отправить GIF'
  } finally {
    sendingId.value = null
  }
}

const nothing = () => undefined

onMounted(() => {
  if (keyAvailable) void loadTrending()
})
</script>

<style scoped>
.gif-picker {
  position: absolute;
  bottom: 64px;
  right: 14px;
  width: min(344px, calc(100vw - 40px));
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: 14px;
  box-shadow: var(--ms-shadow-pop);
  z-index: 40;
  overflow: hidden;
}

.gif-picker-inner {
  display: flex;
  flex-direction: column;
  padding: 8px;
}

.gif-head {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--ms-surface-2);
  border-radius: 10px;
  padding: 4px 8px;
}

.gif-search-icon {
  color: var(--ms-muted-3);
  font-size: 0.9rem;
}

.gif-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--ms-text-strong);
  padding: 6px 2px;
}

.gif-search-btn {
  border: none;
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.8rem;
}

.gif-search-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.gif-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 8px 2px 4px;
  scrollbar-width: none;
}

.gif-chips::-webkit-scrollbar {
  display: none;
}

/* Затухание у края с подсказкой, что лента быстрых запросов продолжается. */
.gif-chips.fade-end {
  mask-image: linear-gradient(to right, black calc(100% - 10px), transparent);
}

.gif-chips.fade-start {
  mask-image: linear-gradient(to right, transparent, black 10px);
}

.gif-chips.fade-start.fade-end {
  mask-image: linear-gradient(
    to right,
    transparent,
    black 10px,
    black calc(100% - 10px),
    transparent
  );
}

.gif-chip {
  border: 1px solid var(--ms-border);
  background: var(--ms-surface);
  color: var(--ms-text);
  font-size: 12.5px;
  border-radius: 14px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.gif-chip:hover {
  background: var(--ms-hover);
}

.gif-chip.active {
  background: var(--ms-accent-soft);
  border-color: var(--ms-accent-border);
}

.gif-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 22px 10px;
  color: var(--ms-muted-2);
  font-size: 13px;
  text-align: center;
}

.gif-status.error {
  color: var(--ms-danger);
}

.gif-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px 0;
}

.gif-tile {
  position: relative;
  border: none;
  padding: 0;
  background: var(--ms-surface-2);
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}

.gif-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gif-tile:hover img {
  opacity: 0.85;
}

.gif-tile:disabled {
  cursor: default;
}

.gif-tile-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ms-backdrop);
}

.gif-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--ms-hairline);
  border-top-color: var(--ms-accent, #2ea25e);
  animation: gif-spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes gif-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
