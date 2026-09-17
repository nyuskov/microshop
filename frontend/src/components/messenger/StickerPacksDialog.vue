<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="stickers-card">
      <!-- Один общий input на диалог: файлы уходят в тот пак, который нажали. -->
      <input
        ref="fileInput"
        class="sr-only-input"
        type="file"
        :accept="STICKER_ACCEPT"
        multiple
        @change="onFiles"
      />
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="stickers-title">Мои стикеры</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Закрыть" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="stickers-body">
        <p class="stickers-hint">
          Стикер — картинка из вашего набора: в переписке он отправляется тапом в панели стикеров и
          показывается без пузыря. Подходят PNG, WebP и GIF до 512 КБ; крупные картинки сервер сам
          уменьшает, а анимацию оставляет как есть.
        </p>

        <p v-if="error" class="stickers-error">{{ error }}</p>

        <div class="stickers-actions">
          <button type="button" class="stickers-btn" @click="startNewPack">
            <q-icon :name="icon('add')" size="18px" />
            Новый пак
          </button>
        </div>

        <label v-if="creating" class="stickers-new">
          <span class="sr-only">Название нового пака</span>
          <input
            ref="newPackInput"
            v-model="newPackTitle"
            type="text"
            :maxlength="MAX_PACK_TITLE"
            placeholder="Название пака"
            @keydown.enter.prevent="createPack"
            @blur="createPack"
          />
        </label>

        <p v-if="store.loading && !store.packs.length" class="stickers-empty">Загружаем…</p>
        <p v-else-if="!store.packs.length" class="stickers-empty">
          Паков пока нет. Создайте первый — и добавьте в него картинки.
        </p>

        <section v-for="pack in store.packs" :key="pack.id" class="pack-block">
          <div class="pack-head">
            <label class="pack-title-field">
              <span class="sr-only">Название пака</span>
              <input
                :value="pack.title"
                type="text"
                :maxlength="MAX_PACK_TITLE"
                @keydown.enter.prevent="rename(pack.id, $event)"
                @blur="rename(pack.id, $event)"
              />
            </label>
            <span class="pack-count">{{ pack.stickers.length }} шт.</span>
            <button
              type="button"
              class="pack-icon-btn"
              :disabled="store.packs.indexOf(pack) === 0"
              aria-label="Пак выше"
              @click="store.movePack(pack.id, -1)"
            >
              <q-icon :name="icon('keyboard_arrow_up')" size="18px" />
            </button>
            <button
              type="button"
              class="pack-icon-btn"
              :disabled="store.packs.indexOf(pack) === store.packs.length - 1"
              aria-label="Пак ниже"
              @click="store.movePack(pack.id, 1)"
            >
              <q-icon :name="icon('keyboard_arrow_down')" size="18px" />
            </button>
            <!-- Удаление подтверждаем на месте: штатные окна браузера не
                 используем — они выбиваются из интерфейса приложения. -->
            <button
              v-if="pendingDelete !== pack.id"
              type="button"
              class="pack-icon-btn danger"
              aria-label="Удалить пак"
              @click="pendingDelete = pack.id"
            >
              <q-icon :name="icon('delete')" size="18px" />
            </button>
            <template v-else>
              <button type="button" class="pack-ask danger" @click="removePack(pack.id)">
                Удалить пак?
              </button>
              <button type="button" class="pack-ask" @click="pendingDelete = null">Нет</button>
            </template>
          </div>

          <div v-if="pack.stickers.length" class="pack-grid">
            <div v-for="sticker in pack.stickers" :key="sticker.id" class="pack-item">
              <img
                :src="mediaUrl(sticker.file_url)"
                :alt="`Стикер в паке ${pack.title}`"
                loading="lazy"
              />
              <button
                type="button"
                class="pack-item-remove"
                :aria-label="`Удалить стикер из пака ${pack.title}`"
                @click="removeSticker(sticker.id)"
              >
                <q-icon :name="icon('close')" size="14px" />
              </button>
            </div>
          </div>
          <p v-else class="pack-hint">В паке пусто.</p>

          <button type="button" class="stickers-btn" @click="pickFiles(pack.id)">
            <q-icon :name="icon('image')" size="18px" />
            Добавить стикеры
          </button>
        </section>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

import { mediaUrl } from '@/config'
import { useStickersStore } from '@/stores/stickers'
import { MAX_STICKER_BYTES, STICKER_ACCEPT } from '@/services/stickers'
import { icon } from '@/utils/icons'

const emit = defineEmits<{ (e: 'close'): void }>()

/** Название пака — как колонка в БД (`sticker_packs.title`). */
const MAX_PACK_TITLE = 60

const store = useStickersStore()

const creating = ref(false)
const newPackTitle = ref('')
const newPackInput = ref<HTMLInputElement | null>(null)
const pendingDelete = ref<number | null>(null)
const error = ref('')

const startNewPack = (): void => {
  creating.value = true
  void nextTick(() => newPackInput.value?.focus())
}

/** Создаёт пак (пустое название сервер заменит на «Мои стикеры»). */
const createPack = (): void => {
  const title = newPackTitle.value.trim()
  creating.value = false
  newPackTitle.value = ''
  void (async () => {
    try {
      await store.createPack(title || undefined)
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось создать пак'
    }
  })()
}

const rename = (packId: number, event: Event): void => {
  const input = event.target as HTMLInputElement
  const title = input.value.trim()
  const current = store.packs.find((pack) => pack.id === packId)
  if (!current || !title || title === current.title) {
    input.value = current?.title ?? title
    return
  }
  void store.renamePack(packId, title).catch((cause: unknown) => {
    error.value = cause instanceof Error ? cause.message : 'Не удалось переименовать пак'
    input.value = current.title
  })
}

const removePack = (packId: number): void => {
  pendingDelete.value = null
  void store.removePack(packId).catch((cause: unknown) => {
    error.value = cause instanceof Error ? cause.message : 'Не удалось удалить пак'
  })
}

const removeSticker = (stickerId: number): void => {
  void store.removeSticker(stickerId).catch((cause: unknown) => {
    error.value = cause instanceof Error ? cause.message : 'Не удалось удалить стикер'
  })
}

// ---------- Загрузка картинок ----------
// Один общий input на диалог: файлы уходят в тот пак, который нажали.
const fileInput = ref<HTMLInputElement | null>(null)
const targetPack = ref<number | null>(null)

const pickFiles = (packId: number): void => {
  targetPack.value = packId
  fileInput.value?.click()
}

const onFiles = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const packId = targetPack.value
  targetPack.value = null
  if (packId === null || files.length === 0) return

  error.value = ''
  void (async () => {
    const failed: string[] = []
    for (const file of files) {
      if (file.size > MAX_STICKER_BYTES) {
        failed.push(`${file.name} — больше ${MAX_STICKER_BYTES / 1024} КБ`)
        continue
      }
      try {
        await store.addSticker(packId, file)
      } catch (cause) {
        failed.push(cause instanceof Error ? cause.message : file.name)
      }
    }
    if (failed.length) {
      error.value = `Не добавились: ${failed.join('; ')}`
    }
  })()
}

void store.load()
</script>

<style scoped>
.stickers-card {
  width: min(620px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--ms-surface);
}

.stickers-title {
  font-size: var(--ms-fs-lg);
  font-weight: 600;
  color: var(--ms-text-strong);
}

.stickers-body {
  overflow-y: auto;
}

.stickers-hint,
.stickers-empty,
.pack-hint {
  margin: 0 0 var(--ms-space-3);
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
  line-height: 1.45;
}

.stickers-error {
  margin: 0 0 var(--ms-space-3);
  padding: var(--ms-space-2) var(--ms-space-3);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
  font-size: var(--ms-fs-sm);
}

.stickers-actions {
  margin-bottom: var(--ms-space-2);
}

.stickers-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--ms-space-1);
  padding: var(--ms-space-1) var(--ms-space-3);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface);
  color: var(--ms-text);
  font-size: var(--ms-fs-sm);
  cursor: pointer;
}

.stickers-btn:hover {
  background: var(--ms-hover);
}

.stickers-new input,
.pack-title-field input {
  width: 100%;
  padding: var(--ms-space-1) var(--ms-space-2);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font-size: var(--ms-fs-base);
}

.pack-block {
  margin-top: var(--ms-space-3);
  padding-top: var(--ms-space-3);
  border-top: 1px solid var(--ms-border);
}

.pack-head {
  display: flex;
  align-items: center;
  gap: var(--ms-space-2);
  margin-bottom: var(--ms-space-2);
}

.pack-title-field {
  flex: 1;
  min-width: 0;
}

.pack-count {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.pack-icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--ms-radius-sm);
  background: transparent;
  color: var(--ms-icon);
  cursor: pointer;
}

.pack-icon-btn:hover:not(:disabled) {
  background: var(--ms-hover);
}

.pack-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.pack-icon-btn.danger:hover {
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
}

.pack-ask {
  border: none;
  background: none;
  color: var(--ms-muted);
  font: inherit;
  cursor: pointer;
  padding: 0 var(--ms-space-1);
}

.pack-ask.danger {
  color: var(--ms-danger);
}

.pack-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: var(--ms-space-2);
  margin-bottom: var(--ms-space-2);
}

.pack-item {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
}

.pack-item img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.pack-item-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ms-border);
  border-radius: 50%;
  background: var(--ms-surface);
  color: var(--ms-danger);
  cursor: pointer;
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
