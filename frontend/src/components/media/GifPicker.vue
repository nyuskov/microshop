<template>
  <div class="gif-picker" @mousedown.self="nothing">
    <div class="gif-picker-inner" @click.stop>
      <div class="gif-head">
        <i class="pi pi-search gif-search-icon"></i>
        <input
          v-model="query"
          class="gif-search-input"
          type="text"
          placeholder="Поиск GIF…"
          @keydown.enter.prevent="doSearch()"
        />
        <button class="gif-search-btn" :disabled="loading" title="Найти" @click="doSearch()">
          <i class="pi pi-arrow-right"></i>
        </button>
      </div>

      <div class="gif-chips">
        <button class="gif-chip" :class="{ active: !query.trim() }" @click="loadTrending()">
          Тренды
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
        Не задан ключ Giphy. Добавьте <b>VITE_GIPHY_API_KEY</b> в файл <b>frontend/.env</b> (см.
        .env.example) и перезапустите frontend.
      </div>
      <div v-else-if="loading" class="gif-status"><span class="gif-spinner"></span> Загрузка…</div>
      <div v-else-if="error" class="gif-status error">{{ error }}</div>
      <div v-else-if="!results.length" class="gif-status">Ничего не найдено</div>
      <div v-else class="gif-grid">
        <button
          v-for="gif in results"
          :key="gif.id"
          class="gif-tile"
          :disabled="sendingId !== null"
          title="Отправить GIF"
          @click="sendGif(gif)"
        >
          <img :src="gif.preview" :alt="gif.title || 'GIF'" loading="lazy" />
          <span v-if="sendingId === gif.id" class="gif-tile-loading">
            <span class="gif-spinner"></span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { sendGifMessage } from '@/services/chatService'
import { fetchTrendingGifs, hasGiphyKey, searchGifs, type GiphyGif } from '@/services/giphy'

const props = defineProps<{
  chatId: number
  replyToId?: number | null
}>()

// Событие «sent» — это подтверждение постановки задачи: сообщение появится в
// ленте чуть позже, когда фоновый воркер скачает GIF и web пришлёт message.new.
const emit = defineEmits<{
  (e: 'sent'): void
}>()

const QUICK_QUERIES = ['😀', 'кот', 'привет', 'спасибо', 'праздник', 'круто']

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
    await sendGifMessage(props.chatId, gif.gif, props.replyToId ?? null)
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
  background: #ffffff;
  border: 1px solid #e2e6ea;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
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
  background: #f1f3f5;
  border-radius: 10px;
  padding: 4px 8px;
}

.gif-search-icon {
  color: #8595a2;
  font-size: 0.9rem;
}

.gif-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: #1c2733;
  padding: 6px 2px;
}

.gif-search-btn {
  border: none;
  background: var(--ms-accent, #2ea25e);
  color: #fff;
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
}

.gif-chip {
  border: 1px solid #e0e5ea;
  background: #fff;
  color: #43525d;
  font-size: 12.5px;
  border-radius: 14px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.gif-chip:hover {
  background: #f2f4f6;
}

.gif-chip.active {
  background: #e3f2e5;
  border-color: #7cc48c;
}

.gif-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 22px 10px;
  color: #8a98a3;
  font-size: 13px;
  text-align: center;
}

.gif-status.error {
  color: #d64545;
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
  background: #eef1f4;
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
  background: rgba(0, 0, 0, 0.35);
}

.gif-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.15);
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
