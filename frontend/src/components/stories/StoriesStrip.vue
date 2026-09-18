<template>
  <div class="stories-wrap" :class="{ mini, expanded: mini && expanded }">
    <!-- В шапке (mini) — сжатый ряд кружков размером с аватар профиля;
         в раскрытой полосе — крупные кружки с подписями. Ряд листается колесом
         мыши и перетаскиванием (useHScroll): иначе крайние истории пропадали
         за краем — особенно в веб-версии, где нет свайпа. -->
    <div
      ref="stripEl"
      class="stories-strip"
      :class="{ 'fade-start': stripEdges.start, 'fade-end': stripEdges.end }"
      @scroll.passive="refreshStripEdges"
      @wheel.passive="onStripWheel"
      @pointerdown="onStripPointerDown"
      @pointermove="onStripPointerMove"
      @pointerup="onStripPointerUp"
      @pointerleave="onStripPointerUp"
      @pointercancel="onStripPointerUp"
    >
      <!-- Моя история: без своей — сразу выбор файла, со своей — открыть/добавить -->
      <div class="story-cell" :style="mini ? { zIndex: 100 } : undefined">
        <button
          class="story-avatar-btn"
          type="button"
          :title="mini ? 'Показать истории' : 'Моя история'"
          :aria-label="mini ? 'Показать истории' : 'Моя история'"
          @click="onMineClick"
        >
          <span
            class="story-avatar"
            :class="{ empty: !mine }"
            :style="mine ? avatarStyle(myName) : undefined"
          >
            <img v-if="myAvatar" :src="myAvatar" alt="" loading="lazy" decoding="async" />
            <template v-else>{{ myInitials }}</template>
          </span>
          <!-- В шапке рядом два кружка с инициалами (этот и аватар профиля) —
               маленький «+» объясняет, что этот кружок про истории. -->
          <span v-if="mini && !mine" class="story-plus" aria-hidden="true">+</span>
        </button>
        <button
          v-if="!mini && !publishing"
          class="story-add"
          type="button"
          title="Добавить историю"
          @click="pickFile"
        >
          <q-icon :name="icon('add')" size="14px" />
        </button>
        <span v-else-if="!mini" class="story-add busy"><span class="mini-spinner"></span></span>
        <span class="story-name">Моя история</span>
      </div>

      <!-- Истории других: точка-кольцо, если есть непросмотренные.
           В шапке кружки находят друг на друга: следующий уходит ПОД предыдущий,
           поэтому z-index убывает слева направо (как в Telegram). -->
      <button
        v-for="(group, index) in stories.others"
        :key="group.user.id"
        class="story-cell"
        type="button"
        :style="mini ? { zIndex: 99 - index } : undefined"
        @click="onGroupClick(group)"
      >
        <span
          class="story-avatar"
          :class="{ unseen: group.has_unseen }"
          :style="avatarStyle(authorName(group))"
        >
          <img
            v-if="authorAvatar(group)"
            :src="authorAvatar(group)"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ authorInitials(group) }}</template>
        </span>
        <span class="story-name">{{ authorName(group) }}</span>
      </button>

      <p v-if="!mini && !stories.others.length && !mine" class="story-hint">
        Здесь появятся истории друзей — они живут 24 часа.
      </p>
    </div>

    <!-- Выбор файла и подпись нужны только раскрытой полосе: в шапке их нет. -->
    <template v-if="!mini">
      <input
        ref="fileInput"
        class="hidden-file"
        type="file"
        accept="image/*,video/*"
        @change="onFileSelected"
      />

      <!-- Подпись к новой истории -->
      <q-dialog v-model="captionOpen">
        <q-card class="story-caption-card">
          <q-card-section>
            <div class="story-caption-title">Новая история</div>
            <p class="story-caption-hint">
              {{ pendingFile?.name }} — можно добавить подпись. История исчезнет через 24 часа.
            </p>
            <input
              v-model="caption"
              class="story-caption-input"
              type="text"
              maxlength="140"
              placeholder="Подпись (необязательно)"
              @keyup.enter="publish"
            />
            <p v-if="stories.error" class="story-caption-error">{{ stories.error }}</p>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Отмена" @click="cancelPublish" />
            <q-btn
              color="primary"
              unelevated
              label="Опубликовать"
              :loading="publishing"
              @click="publish"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, ref } from 'vue'
import { Notify } from 'quasar'

import { mediaUrl } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { useStoriesStore } from '@/stores/stories'
import { useHScroll } from '@/composables/useHScroll'
import type { StoryGroup } from '@/services/stories'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'

const emit = defineEmits<{
  (e: 'open-story', storyId: number): void
  /** Нажатие по сжатым историям в шапке — раскрыть полосу под шапкой. */
  (e: 'toggle-expand'): void
}>()

const props = withDefaults(
  defineProps<{
    /** Сжатый вид для шапки: мелкие кружки без подписей и без выбора файла. */
    mini?: boolean
    /** Полоса историй раскрыта — кружок в шапке подсвечен (для mini). */
    expanded?: boolean
  }>(),
  { mini: false, expanded: false }
)

/**
 * Клик по кружку: в шапке он раскрывает полосу (истории «опускаются» под шапку),
 * в раскрытой полосе — открывает выбранную историю.
 */
const onGroupClick = (group: StoryGroup) => {
  if (props.mini) {
    emit('toggle-expand')
    return
  }
  emit('open-story', firstUnseenId(group))
}

const stories = useStoriesStore()
const authStore = useAuthStore()

/**
 * Прокрутка полосы историй.
 *
 * В сжатом виде (шапка) ряд не влезает уже с четырёх историй: без прокрутки
 * крайние просто уезжали за край и их нельзя было открыть. Колесо мыши и
 * перетаскивание работают одинаково и в веб-версии, и на телефоне (там ещё и
 * свайп), а затухание у края подсказывает, что полоса продолжается.
 */
const {
  el: stripEl,
  edges: stripEdges,
  refresh: refreshStripEdges,
  onWheel: onStripWheel,
  onPointerDown: onStripPointerDown,
  onPointerMove: onStripPointerMove,
  onPointerUp: onStripPointerUp
} = useHScroll(() => stories.groups.length)

const fileInput = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const caption = ref('')
const captionOpen = ref(false)
const publishing = computed(() => stories.publishing)

const mine = computed(() => stories.mine)

const myAvatar = computed(() => {
  const me = authStore.current_user
  const path = me?.avatar_thumb_url || me?.avatar_url
  return path ? mediaUrl(path) : ''
})

const myInitials = computed(() => {
  const user = authStore.current_user
  const name = user ? displayName(user) : ''
  return name ? initials(name) : 'Я'
})

/** Имя для фона аватара-заглушки (чтобы акцентное кольцо было видно). */
const myName = computed(() => {
  const user = authStore.current_user
  return user ? displayName(user) : ''
})

const authorName = (group: StoryGroup) => displayName(group.user) || `@${group.user.username}`

const authorAvatar = (group: StoryGroup) => {
  const path = avatarUrlOf(group.user)
  return path ? mediaUrl(path) : ''
}

const authorInitials = (group: StoryGroup) => initials(authorName(group))

/** Первая непросмотренная история автора (или первая, если всё просмотрено). */
const firstUnseenId = (group: StoryGroup): number => {
  const unseen = group.items.find((item) => !item.viewed)
  return (unseen ?? group.items[0]).id
}

const pickFile = () => fileInput.value?.click()

/** Открыть свою историю (если она уже есть), иначе — выбрать файл. */
const onMineClick = () => {
  // В шапке кружок только раскрывает полосу: выбор файла живёт в полосе.
  if (props.mini) {
    emit('toggle-expand')
    return
  }
  const myStory = mine.value?.items[0]
  if (myStory) emit('open-story', myStory.id)
  else pickFile()
}

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    Notify.create({ message: 'История может быть фото или видео', timeout: 3000 })
    return
  }
  pendingFile.value = file
  caption.value = ''
  captionOpen.value = true
}

const cancelPublish = () => {
  captionOpen.value = false
  pendingFile.value = null
  caption.value = ''
}

const publish = async () => {
  const file = pendingFile.value
  if (!file) return
  const ok = await stories.publish(file, caption.value.trim())
  if (!ok) {
    Notify.create({ message: stories.error || 'Не удалось опубликовать историю', timeout: 4000 })
    return
  }
  cancelPublish()
}
</script>

<style scoped>
.stories-wrap {
  position: relative;
}

/* Раскрытая полоса (под шапкой): крупные кружки с подписями, переносятся на
   ряды. Высоту ограничивает обёртка в ChatSidebar — там же анимация. */
.stories-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  padding: 8px 14px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}

.stories-strip .story-avatar,
.stories-strip .story-avatar-btn {
  width: 56px;
  height: 56px;
}

.stories-strip .story-cell {
  width: 68px;
}

.stories-strip .story-add {
  margin-top: -13px;
  margin-left: 36px;
  width: 22px;
  height: 22px;
}

/* Сжатый вид для шапки: ряд кружков размером с аватар профиля, без подписей,
   без разделительной линии и без выбора файла — ровно как значки рядом. */
.stories-wrap.mini {
  flex: 0 1 auto;
  min-width: 0;
}

.mini .stories-strip {
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: 0;
  padding: 2px;
  border-bottom: none;
  overflow-x: auto;
  overflow-y: hidden;
}

/* Затухание у того края, где действительно есть скрытые истории: подсказка,
   что полосу можно листать (и что за краем ещё кто-то есть). */
.mini .stories-strip.fade-end {
  mask-image: linear-gradient(to right, black calc(100% - 10px), transparent);
}

.mini .stories-strip.fade-start {
  mask-image: linear-gradient(to right, transparent, black 10px);
}

.mini .stories-strip.fade-start.fade-end {
  mask-image: linear-gradient(
    to right,
    transparent,
    black 10px,
    black calc(100% - 10px),
    transparent
  );
}

/* Наложение кружков друг на друга, как в Telegram: каждый следующий сдвинут
   влево на треть кружка и уходит под предыдущий (z-index задан в разметке). */
.mini .story-cell {
  position: relative;
}

.mini .story-cell + .story-cell {
  margin-left: -11px;
}

/* Ячейка — 34 px (как значки в шапке): внутри кружок 28 px по центру, а линия
   ореола идёт по краю ячейки. Зазор до картинки — 2 px (≈0.5 мм).
   Центрирование задано явно: кнопка по умолчанию ставит круг в угол. */
.mini .story-avatar-btn,
.mini .story-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
}

.mini .story-avatar {
  width: 28px;
  height: 28px;
}

/* Кружок в шапке: сам аватар жёстко обрезан по кругу (clip-path работает
   даже когда браузер рисует кнопку отдельным слоем — при нажатии), а тонкая
   линия ореола живёт отдельным слоем (::after) и обрезкой не затрагивается. */
.mini .story-avatar {
  border: none;
  box-shadow: none;
  border-radius: 50%;
  overflow: hidden;
  clip-path: circle(50%);
}

/* Фото внутри тоже по кругу: кружок останется полным при любом размере. */
.mini .story-avatar img {
  border-radius: 50%;
  clip-path: circle(50%);
}

.mini .story-cell {
  position: relative;
  gap: 0;
  /* Нажатие больше не масштабирует кружок: у transformed-слоя браузер
     терял скругление, и вместо круга мелькал квадрат. */
  transform: none;
}

.mini .story-cell:active {
  transform: none;
}

/* Тонкая светлая линия по кругу — 1 px по краю ячейки (зазор 2 px от картинки).
   Полупрозрачный серый: плотный --ms-muted-3 выглядел слишком тёмным, а совсем
   светлый --ms-border сливался с фоном. Итого кружок с линией 34 px. */
.mini .story-cell::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid color-mix(in srgb, var(--ms-muted-3) 45%, transparent);
  border-radius: 50%;
  pointer-events: none;
}

/* Непросмотренное — та же линия акцентом. При нажатии цвет не меняется:
   ореол постоянный, как на образце. */
.mini .story-cell:has(.story-avatar.unseen)::after {
  border-color: var(--ms-accent);
}

/* Кружок без своей истории: значок «+» в углу. Без него вход в истории не
   отличить от аватара профиля — рядом стоят два одинаковых кружка с инициалами
   (подпись `title` на тач-устройствах не видна, а `aria-label` нужен только
   скринридеру). */
.mini .story-plus {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  /* Знак «+» живёт в кружке 14 px: крупнее 11 px он не влезает, но множитель
     настройки «Размер текста» учитываем. */
  font-size: calc(11px * var(--ms-text-scale, 1));
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}

/* Полоса историй раскрыта: кружок в шапке подсвечен — как значок поиска в
   открытом состоянии. Тот же ореол, но толще: состояние читается сразу. */
.mini.expanded .story-cell::after {
  border-color: var(--ms-accent);
  border-width: 2px;
}

/* Теней-ореолов у аватара в шапке нет: они складывались с линией. */
.mini .story-avatar-btn:active .story-avatar,
.mini .story-cell:active .story-avatar {
  box-shadow: none;
}

.mini .story-name,
.mini .story-hint {
  display: none;
}

/* Фокус с клавиатуры/тапа: общий контур (appearance.css) обводит кнопку
   прямоугольником — вокруг круглого кружка это выглядит чужеродно. Глушим
   контур с той же специфичностью, что у общей темы, а круглый ореол рисуем
   тенью (box-shadow всегда повторяет радиус кружка). */
:global(html .messenger-shell .story-avatar-btn:focus-visible),
:global(html .messenger-shell .story-cell:focus-visible),
:global(html .messenger-shell .story-add:focus-visible) {
  outline: none;
}

.story-avatar-btn:focus-visible .story-avatar,
.story-cell:focus-visible .story-avatar,
.story-add:focus-visible {
  box-shadow:
    0 0 0 2px var(--ms-surface),
    0 0 0 4px var(--ms-accent);
}

.stories-strip::-webkit-scrollbar {
  display: none;
}

.story-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 68px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  flex: 0 0 auto;
  transition: transform 0.15s ease;
  /* Круглый кружок при нажатии не подсвечиваем прямоугольником: браузерная
     подсветка тапа рисует квадрат поверх кружка. */
  -webkit-tap-highlight-color: transparent;
}

.story-cell:active {
  transform: scale(0.96);
}

.story-avatar,
.story-avatar-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
}

.story-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-weight: 600;
  color: var(--ms-on-accent);
  background: var(--ms-accent);
  border: 2px solid var(--ms-surface);
  box-shadow: 0 0 0 2px var(--ms-border);
}

.story-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Непросмотренная история — акцентное кольцо (как в мессенджерах). */
.story-avatar.unseen {
  box-shadow: 0 0 0 2.5px var(--ms-accent);
}

.story-avatar-btn:active .story-avatar,
.story-cell:active .story-avatar {
  box-shadow: 0 0 0 3px var(--ms-accent);
}

.story-avatar.empty {
  background: var(--ms-surface-2);
  color: var(--ms-muted);
}

.story-avatar-btn {
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
  /* Круглый кружок не подсвечиваем прямоугольником при нажатии. */
  -webkit-tap-highlight-color: transparent;
}

.story-add {
  position: relative;
  margin-top: -13px;
  margin-left: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--ms-surface);
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  box-shadow: var(--ms-shadow-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.story-add.busy {
  background: var(--ms-muted-2);
}

.story-name {
  max-width: 68px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.1px;
  color: var(--ms-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.story-hint {
  align-self: center;
  margin: 0;
  padding-left: 2px;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--ms-muted-3);
}

.hidden-file {
  display: none;
}

.story-caption-card {
  width: min(360px, calc(100vw - 32px));
}

.story-caption-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ms-text-strong);
}

.story-caption-hint {
  margin: 4px 0 10px;
  font-size: 12.5px;
  color: var(--ms-muted);
}

.story-caption-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font: inherit;
}

.story-caption-error {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ms-danger);
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--ms-on-accent) 50%, transparent);
  border-top-color: var(--ms-on-accent);
  border-radius: 50%;
  animation: story-spin 0.8s linear infinite;
}

@keyframes story-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
