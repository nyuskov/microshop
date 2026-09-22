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
        <div class="stickers-title">{{ t('Мои стикеры') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="stickers-body">
        <p class="stickers-hint">
          {{
            t(
              'Стикер — картинка из вашего набора: в переписке он отправляется тапом в панели стикеров и показывается без пузыря. Подходят PNG, WebP и GIF до 512 КБ; крупные картинки сервер сам уменьшает, а анимацию оставляет как есть.'
            )
          }}
        </p>

        <p v-if="error" class="stickers-error">{{ error }}</p>

        <div class="stickers-actions">
          <button type="button" class="stickers-btn" @click="startNewPack">
            <q-icon :name="icon('add')" size="18px" />
            {{ t('Новый пак') }}
          </button>
        </div>

        <!-- Встроенные наборы приложения: у сервера их нет, поэтому «добавить» —
             это скачать картинки и загрузить их своим паком. Так же устроено
             «ДОБАВИТЬ СТИКЕРЫ» в Телеграме, только там набор лежит на сервере. -->
        <section class="sets-block">
          <h3 class="sets-title">{{ t('Наборы приложения') }}</h3>
          <div v-for="set in STANDARD_STICKER_PACKS" :key="set.key" class="set-row">
            <span class="set-preview" aria-hidden="true">
              <img
                v-for="preview in set.stickers.slice(0, 3)"
                :key="preview.url"
                :src="preview.url"
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
            <span class="set-info">
              <span class="set-name">{{ t(set.title) }}</span>
              <span class="set-count">{{ t('{count} шт.', { count: set.stickers.length }) }}</span>
            </span>
            <span v-if="store.isStandardSetImported(set.key)" class="set-done">
              <q-icon :name="icon('check')" size="16px" />
              {{ t('Добавлен') }}
            </span>
            <button
              v-else
              type="button"
              class="stickers-btn"
              :disabled="isImporting"
              @click="addStandardSet(set)"
            >
              {{ importLabel(set) }}
            </button>
          </div>
        </section>

        <label v-if="creating" class="stickers-new">
          <span class="sr-only">{{ t('Название нового пака') }}</span>
          <input
            ref="newPackInput"
            v-model="newPackTitle"
            type="text"
            :maxlength="MAX_PACK_TITLE"
            :placeholder="t('Название пака')"
            @keydown.enter.prevent="createPack"
            @blur="createPack"
          />
        </label>

        <p v-if="store.loading && !store.packs.length" class="stickers-empty">
          {{ t('Загружаем…') }}
        </p>
        <p v-else-if="!store.packs.length" class="stickers-empty">
          {{ t('Паков пока нет. Создайте первый — и добавьте в него картинки.') }}
        </p>

        <section v-for="pack in store.packs" :key="pack.id" class="pack-block">
          <div class="pack-head">
            <label class="pack-title-field">
              <span class="sr-only">{{ t('Название пака') }}</span>
              <input
                :value="pack.title"
                type="text"
                :maxlength="MAX_PACK_TITLE"
                @keydown.enter.prevent="rename(pack.id, $event)"
                @blur="rename(pack.id, $event)"
              />
            </label>
            <span class="pack-count">{{ t('{count} шт.', { count: pack.stickers.length }) }}</span>
            <!-- Публикация набора (только владелец): он появится у всех в блоке
                 «Наборы приложения», и любой добавит его себе целиком. -->
            <button
              v-if="authStore.isOwner"
              type="button"
              class="pack-icon-btn"
              :class="{ published: pack.is_preset }"
              :aria-pressed="Boolean(pack.is_preset)"
              :aria-label="
                pack.is_preset ? t('Снять набор с публикации') : t('Опубликовать набор для всех')
              "
              :title="
                pack.is_preset
                  ? t('Набор публичный: его видят все и могут добавить себе')
                  : t('Опубликовать набор: его увидят все и смогут добавить себе')
              "
              @click="togglePreset(pack)"
            >
              <q-icon :name="icon('campaign')" size="18px" />
            </button>
            <button
              type="button"
              class="pack-icon-btn"
              :disabled="store.packs.indexOf(pack) === 0"
              :aria-label="t('Пак выше')"
              @click="store.movePack(pack.id, -1)"
            >
              <q-icon :name="icon('keyboard_arrow_up')" size="18px" />
            </button>
            <button
              type="button"
              class="pack-icon-btn"
              :disabled="store.packs.indexOf(pack) === store.packs.length - 1"
              :aria-label="t('Пак ниже')"
              @click="store.movePack(pack.id, 1)"
            >
              <q-icon :name="icon('keyboard_arrow_down')" size="18px" />
            </button>
            <!-- Удаление подтверждаем общим модальным окном: штатные окна
                 браузера в приложении не используем. -->
            <button
              type="button"
              class="pack-icon-btn danger"
              :aria-label="t('Удалить пак')"
              @click="removePack(pack)"
            >
              <q-icon :name="icon('delete')" size="18px" />
            </button>
          </div>

          <div v-if="pack.stickers.length" class="pack-grid">
            <div v-for="sticker in pack.stickers" :key="sticker.id" class="pack-item">
              <img
                :src="mediaUrl(sticker.file_url)"
                :alt="t('Стикер в паке {title}', { title: pack.title })"
                loading="lazy"
              />
              <button
                type="button"
                class="pack-item-remove"
                :aria-label="t('Удалить стикер из пака {title}', { title: pack.title })"
                @click="removeSticker(sticker.id)"
              >
                <q-icon :name="icon('close')" size="14px" />
              </button>
            </div>
          </div>
          <p v-else class="pack-hint">{{ t('В паке пусто.') }}</p>

          <button type="button" class="stickers-btn" @click="pickFiles(pack.id)">
            <q-icon :name="icon('image')" size="18px" />
            {{ t('Добавить стикеры') }}
          </button>
        </section>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

import { mediaUrl } from '@/config'
import { t } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useStickersStore } from '@/stores/stickers'
import { getErrorMessage } from '@/services/errors'
import { MAX_STICKER_BYTES, STICKER_ACCEPT, type StickerPack } from '@/services/stickers'
import { STANDARD_STICKER_PACKS, type StandardStickerPack } from '@/utils/standardStickers'
import { useStandardSetImport } from '@/composables/useStandardSetImport'
import { confirmDialog } from '@/utils/appDialogs'
import { icon } from '@/utils/icons'

const emit = defineEmits<{ (e: 'close'): void }>()

/**
 * Публикация набора (владелец): набор появится у всех в «Наборы приложения».
 *
 * Это серверная операция: предустановленные наборы приложения живут статикой, а
 * вот авторские нужно положить на сервер — тогда их видно всем и «добавить весь
 * набор» становится одним запросом копирования (файлы переиспользуются).
 */
const togglePreset = (pack: StickerPack): void => {
  void store.setPackPreset(pack.id, !pack.is_preset).catch((cause: unknown) => {
    error.value = getErrorMessage(cause, t('Не удалось изменить публикацию'))
  })
}

/** Название пака — как колонка в БД (`sticker_packs.title`). */
const MAX_PACK_TITLE = 60

const store = useStickersStore()
/** Публиковать наборы может только владелец (`is_superuser`). */
const authStore = useAuthStore()

const creating = ref(false)
const newPackTitle = ref('')
const newPackInput = ref<HTMLInputElement | null>(null)
const error = ref('')

const startNewPack = (): void => {
  creating.value = true
  void nextTick(() => newPackInput.value?.focus())
}
/** Какой встроенный набор сейчас добавляем и как это показать — общая логика
 *  с панелью стикеров (`composables/useStandardSetImport.ts`). */
const { isImporting, label: importLabel, run: runImport } = useStandardSetImport()

/** «Добавить весь набор»: текст ошибки показываем строкой под списком. */
const addStandardSet = (set: StandardStickerPack): void => {
  void runImport(set).then((message) => {
    if (message) error.value = message
  })
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
      error.value = getErrorMessage(cause, t('Не удалось создать пак'))
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
    error.value = getErrorMessage(cause, t('Не удалось переименовать пак'))
    input.value = current.title
  })
}

const removePack = async (pack: StickerPack): Promise<void> => {
  const agreed = await confirmDialog({
    title: t('Удалить пак «{title}»?', { title: pack.title }),
    message: t(
      '{count} стикеров исчезнут из библиотеки. Отправленные сообщения со стикерами останутся.',
      { count: pack.stickers.length }
    ),
    okLabel: t('Удалить'),
    danger: true
  })
  if (!agreed) return
  try {
    await store.removePack(pack.id)
    error.value = ''
  } catch (cause) {
    error.value = getErrorMessage(cause, t('Не удалось удалить пак'))
  }
}

const removeSticker = (stickerId: number): void => {
  void store.removeSticker(stickerId).catch((cause: unknown) => {
    error.value = getErrorMessage(cause, t('Не удалось удалить стикер'))
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

/**
 * Загружает выбранные картинки в пак.
 *
 * Ошибки копим и показываем одним сообщением: обычно так грузят несколько
 * стикеров сразу, и разбираться с пятью отдельными окнами было бы мучением.
 */
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
        failed.push(
          t('{name} — больше {size} КБ', { name: file.name, size: MAX_STICKER_BYTES / 1024 })
        )
        continue
      }
      try {
        await store.addSticker(packId, file)
      } catch (cause) {
        // Запасной текст — имя файла: в пачке понятно, какой именно не прошёл.
        failed.push(getErrorMessage(cause, file.name))
      }
    }
    if (failed.length) {
      error.value = t('Не добавились: {list}', { list: failed.join('; ') })
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

/* ---------- Встроенные наборы приложения ---------- */
.sets-block {
  display: flex;
  flex-direction: column;
  gap: var(--ms-space-2);
  padding: var(--ms-space-3);
  margin-bottom: var(--ms-space-3);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-lg);
  background: var(--ms-surface-2);
}

.sets-title {
  margin: 0;
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ms-muted-2);
}

.set-row {
  display: flex;
  align-items: center;
  gap: var(--ms-space-2);
}

.set-preview {
  display: inline-flex;
  gap: 2px;
  flex: none;
}

.set-preview img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}

.set-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.set-name {
  font-size: var(--ms-fs-base);
  font-weight: 600;
  color: var(--ms-text-strong);
}

.set-count {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

/* Отметка «уже добавлен»: тот же акцент, что у выбранного варианта в списках. */
.set-done {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-accent);
}

/* Опубликованный набор: значок в акценте — видно, что он у всех. */
.pack-icon-btn.published {
  color: var(--ms-accent);
}
</style>
