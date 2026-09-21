<template>
  <div class="ms-overlay sticker-set-overlay" @click.self="emit('close')">
    <div
      class="ms-overlay-card ms-overlay-card--sm"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Набор «{title}»', { title: set.title })"
    >
      <div class="ms-overlay-head">
        <h2 class="ms-overlay-title">
          <span class="sticker-set-name">{{ set.title }}</span>
          <span class="sticker-set-count">{{
            t('{count} шт.', { count: set.images.length })
          }}</span>
        </h2>
        <button type="button" class="icon-btn" :aria-label="t('Закрыть')" @click="emit('close')">
          <q-icon :name="icon('close')" size="20px" />
        </button>
      </div>

      <!-- Сетка набора: тап отправляет стикер, как из панели ввода. -->
      <div class="ms-overlay-body">
        <div class="sticker-set-grid">
          <button
            v-for="image in set.images"
            :key="image.url"
            type="button"
            class="sticker-set-item"
            :title="t('Отправить: {name}', { name: image.alt })"
            :aria-label="t('Отправить стикер {name}', { name: image.alt })"
            @click="emit('send', stickerSendRef(set, image))"
          >
            <img :src="image.url" alt="" loading="lazy" decoding="async" />
          </button>
        </div>
        <p v-if="!set.images.length" class="sticker-set-empty">
          {{ t('В наборе пока нет стикеров.') }}
        </p>
      </div>

      <div class="ms-overlay-foot">
        <!-- Свой набор добавлять некуда: он уже в «Моих стикерах». -->
        <span v-if="set.own" class="sticker-set-note">{{ t('Это ваш набор') }}</span>
        <span v-else-if="added" class="sticker-set-note added">
          <q-icon :name="icon('check')" size="18px" />
          {{ t('Добавлен') }}
        </span>
        <button
          v-else
          type="button"
          class="sticker-set-add"
          :class="`state-${busy ? 'busy' : 'add'}`"
          :disabled="busy"
          @click="add()"
        >
          <q-icon :name="icon(busy ? 'schedule' : 'add')" size="18px" />
          <span>{{ buttonLabel }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Окно набора стикеров — как в Телеграме: тап по стикеру в сообщении открывает
 * весь его набор, и оттуда набор можно добавить себе целиком.
 *
 * Здесь же и отправка: тап по стикеру в сетке уходит сообщением ровно так же, как
 * из панели ввода (метка набора едет в имени файла — `utils/presetStickers.ts`).
 *
 * Набор приходит готовым (`utils/stickerSet.ts`): окно не знает, свой это пак,
 * публичный или встроенный, — только что с ним можно сделать.
 */
import { computed, ref } from 'vue'

import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import { stickerSendRef, type StickerSetRef, type StickerSendRef } from '@/utils/stickerSet'
import { useStickersStore } from '@/stores/stickers'
import { getErrorMessage } from '@/services/errors'
import { useStandardSetImport } from '@/composables/useStandardSetImport'
import { presetSetOfKey } from '@/utils/presetStickers'

const props = defineProps<{
  /** Набор, который показываем. */
  set: StickerSetRef
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Отправить стикер из окна сообщением. */
  (e: 'send', sticker: StickerSendRef): void
  /** Не получилось добавить набор — показать плашку. */
  (e: 'error', message: string): void
}>()

const store = useStickersStore()
const { importingKey, label: setImportLabel, run: runSetImport } = useStandardSetImport()

/** Идёт копирование серверного набора (встроенный показывает `importingKey`). */
const copying = ref(false)

/** Встроенный набор приложения: добавление — скачивание и загрузка картинок. */
const standardSet = computed(() => presetSetOfKey(props.set.setKey))

const busy = computed<boolean>(() =>
  standardSet.value ? importingKey.value === standardSet.value.key : copying.value
)

/** Набор уже есть: встроенный — по отметке, серверный — по названию пака. */
const added = computed<boolean>(() => {
  if (props.set.packId !== undefined) {
    return store.packs.some((pack) => pack.title === props.set.title)
  }
  return standardSet.value !== null && store.isStandardSetImported(standardSet.value.key)
})

const buttonLabel = computed<string>(() => {
  if (busy.value && standardSet.value) return setImportLabel(standardSet.value)
  return busy.value ? t('Добавляем…') : t('Добавить весь набор')
})

/** «Добавить весь набор»: серверный копируется одним запросом, встроенный — импортом. */
const add = (): void => {
  const packId = props.set.packId
  if (packId !== undefined) {
    copying.value = true
    void store
      .addPreset(packId)
      .catch((cause: unknown) => {
        emit('error', getErrorMessage(cause, t('Не удалось добавить набор')))
      })
      .finally(() => {
        copying.value = false
      })
    return
  }
  const set = standardSet.value
  if (!set) return
  void runSetImport(set).then((message) => {
    if (message) emit('error', message)
  })
}
</script>

<style scoped>
.sticker-set-overlay {
  /* Окно узкое: набор — сетка картинок, широкая карточка только растянет её. */
  align-items: center;
}

.sticker-set-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sticker-set-count {
  flex: none;
  font-family: var(--ms-font);
  font-size: var(--ms-fs-xs);
  font-weight: 400;
  color: var(--ms-muted-2);
}

.sticker-set-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: var(--ms-space-2);
}

.sticker-set-item {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: var(--ms-space-1);
  border: none;
  border-radius: var(--ms-radius-sm);
  background: transparent;
  cursor: pointer;
  transition: background var(--ms-dur-fast) var(--ms-ease);
}

.sticker-set-item:hover {
  background: var(--ms-hover);
}

.sticker-set-item img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.sticker-set-empty {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted-2);
}

/* Подвал: у одинокого действия не должно быть «кнопки в углу» меньше текста. */
.sticker-set-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ms-space-1);
  width: 100%;
  padding: 9px var(--ms-space-3);
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

.sticker-set-add:hover:not(:disabled) {
  border-color: var(--ms-accent);
}

.sticker-set-note.added {
  cursor: default;
}

.sticker-set-note {
  display: inline-flex;
  align-items: center;
  gap: var(--ms-space-1);
  width: 100%;
  justify-content: center;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-muted-2);
}

.sticker-set-note.added {
  color: var(--ms-accent);
}
</style>
