<template>
  <Teleport to="body">
    <div
      v-if="current"
      ref="trapContainer"
      class="lb-overlay"
      :class="{ dragging }"
      :style="overlayStyle"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
      tabindex="-1"
      @click.self="emit('close')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="lb-topbar">
        <span class="lb-name" :title="current.name">{{ current.name }}</span>
        <span v-if="images.length > 1" class="lb-count">{{ index + 1 }} / {{ images.length }}</span>
        <a
          v-if="current.url"
          class="lb-icon-btn lb-download"
          :href="current.url"
          :download="current.name"
          target="_blank"
          rel="noopener"
          title="Скачать"
          aria-label="Скачать изображение"
        >
          <q-icon :name="icon('download')" size="22px" />
        </a>
        <button class="lb-icon-btn lb-close" title="Закрыть (Esc)" @click="emit('close')">
          <q-icon :name="icon('close')" size="24px" />
        </button>
      </div>

      <button
        v-if="images.length > 1"
        class="lb-icon-btn lb-nav lb-prev"
        title="Назад (←)"
        aria-label="Предыдущее изображение"
        @click.stop="emit('prev')"
      >
        <q-icon :name="icon('chevron_left')" size="32px" />
      </button>

      <img
        v-if="current.url"
        ref="imageRef"
        :key="current.id"
        :src="current.url"
        :alt="current.name"
        class="lb-image"
        :style="imageStyle"
        decoding="async"
        @click.stop
      />
      <!-- Зашифрованное вложение расшифровывается по запросу (см. utils/lightbox):
           пока ссылки нет, показываем ожидание, а не «битую» картинку.
           Подписи рядом с кружком нет — крутится и так понятно. -->
      <div v-else class="lb-loading" role="status">
        <BrandSpinner :size="48" label="Открываем изображение" />
      </div>

      <button
        v-if="images.length > 1"
        class="lb-icon-btn lb-nav lb-next"
        title="Вперёд (→)"
        aria-label="Следующее изображение"
        @click.stop="emit('next')"
      >
        <q-icon :name="icon('chevron_right')" size="32px" />
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'
import BrandSpinner from '@/components/common/BrandSpinner.vue'

export interface LightboxImage {
  id: number
  url: string
  name: string
}

const props = defineProps<{
  images: LightboxImage[]
  index: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

const current = computed<LightboxImage | null>(() => props.images[props.index] ?? null)

// Лайтбокс — свой оверлей: Tab не должен уходить на страницу под ним.
const { container: trapContainer } = useFocusTrap(() => current.value !== null)

// ---------------------------------------------------------------------------
// Жесты (телефон): свайп влево/вправо — соседний кадр, свайп вниз — закрыть,
// двойной тап — зум. Раньше оверлей не слушал касания вообще: между кадрами
// можно было ходить только кнопками ‹ ›, а их на телефоне ещё надо найти.
// ---------------------------------------------------------------------------

/** Во сколько раз увеличивает двойной тап. */
const ZOOM_SCALE = 2.5
/** Сдвиг, после которого свайп листает кадр (по 60 px в каждую сторону). */
const SWIPE_NAV_PX = 60
/** Сдвиг вниз, после которого просмотр закрывается. */
const SWIPE_CLOSE_PX = 90
/** Окно двойного тапа и допуск по месту (палец попадает не пиксель в пиксель). */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 40
/** Меньший сдвиг — ещё не жест, а дрожание пальца при тапе. */
const DRAG_MIN_PX = 8

const imageRef = ref<HTMLImageElement | null>(null)
/** Сдвиг кадра за пальцем (свайп вбок/вниз): до отпускания ничего не решаем. */
const dragX = ref(0)
const dragY = ref(0)
/** Идёт жест прямо сейчас — на это время выключаем CSS-переход. */
const dragging = ref(false)
/** Увеличенный кадр: тогда палец двигает картинку, а не листает её. */
const zoomed = ref(false)
const panX = ref(0)
const panY = ref(0)
/** Точка зума в процентах от кадра: увеличиваем туда, куда попал палец. */
const originX = ref(50)
const originY = ref(50)
/** Пределы панорамы — половина вылезшей за экран части кадра. */
let panLimitX = 0
let panLimitY = 0

let activePointer: number | null = null
let startX = 0
let startY = 0
let startPanX = 0
let startPanY = 0
let gesture: 'none' | 'nav' | 'close' | 'pan' = 'none'
let lastTapAt = 0
let lastTapX = 0
let lastTapY = 0

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const resetGesture = () => {
  dragX.value = 0
  dragY.value = 0
  dragging.value = false
  gesture = 'none'
}

const resetZoom = () => {
  zoomed.value = false
  panX.value = 0
  panY.value = 0
  originX.value = 50
  originY.value = 50
  panLimitX = 0
  panLimitY = 0
}

/** Зум по двойному тапу: второй тап возвращает кадр в исходный вид. */
const toggleZoom = (clientX: number, clientY: number) => {
  const image = imageRef.value
  if (zoomed.value || !image) {
    resetZoom()
    return
  }
  const rect = image.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  originX.value = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)
  originY.value = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100)
  panLimitX = (rect.width * (ZOOM_SCALE - 1)) / 2
  panLimitY = (rect.height * (ZOOM_SCALE - 1)) / 2
  panX.value = 0
  panY.value = 0
  zoomed.value = true
}

const onPointerDown = (event: PointerEvent) => {
  // Мышь тянет кадр левой кнопкой; правая — контекстное меню браузера.
  if (event.pointerType === 'mouse' && event.button !== 0) return
  activePointer = event.pointerId
  startX = event.clientX
  startY = event.clientY
  startPanX = panX.value
  startPanY = panY.value
  gesture = 'none'
}

const onPointerMove = (event: PointerEvent) => {
  if (activePointer === null || event.pointerId !== activePointer) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (gesture === 'none') {
    if (Math.abs(dx) < DRAG_MIN_PX && Math.abs(dy) < DRAG_MIN_PX) return
    if (zoomed.value) {
      gesture = 'pan'
    } else if (Math.abs(dx) > Math.abs(dy)) {
      // Вбок листаем только когда есть соседний кадр, иначе жест бессмысленный.
      if (props.images.length < 2) return
      gesture = 'nav'
    } else {
      // Вверх кадр не уезжает — так жест не спутать с закрытием.
      gesture = dy > 0 ? 'close' : 'none'
      if (gesture === 'none') return
    }
    dragging.value = true
  }
  if (gesture === 'nav') dragX.value = dx
  else if (gesture === 'close') dragY.value = Math.max(0, dy)
  else if (gesture === 'pan') {
    panX.value = clamp(startPanX + dx, -panLimitX, panLimitX)
    panY.value = clamp(startPanY + dy, -panLimitY, panLimitY)
  }
}

const onPointerUp = (event: PointerEvent) => {
  if (activePointer === null || event.pointerId !== activePointer) return
  activePointer = null
  const decided = gesture
  const dx = dragX.value
  const dy = dragY.value
  const moved = Math.abs(dx) > 0 || Math.abs(dy) > 0
  resetGesture()

  if (decided === 'nav') {
    if (dx <= -SWIPE_NAV_PX) emit('next')
    else if (dx >= SWIPE_NAV_PX) emit('prev')
    return
  }
  if (decided === 'close') {
    if (dy >= SWIPE_CLOSE_PX) emit('close')
    return
  }
  if (decided === 'pan' || moved) return

  // Это был тап: пара тапов подряд превращается в зум.
  const now = Date.now()
  const near =
    Math.abs(event.clientX - lastTapX) < DOUBLE_TAP_SLOP &&
    Math.abs(event.clientY - lastTapY) < DOUBLE_TAP_SLOP
  if (now - lastTapAt < DOUBLE_TAP_MS && near) {
    lastTapAt = 0
    toggleZoom(event.clientX, event.clientY)
    return
  }
  lastTapAt = now
  lastTapX = event.clientX
  lastTapY = event.clientY
}

const imageStyle = computed<Record<string, string>>(() => {
  const x = dragX.value + panX.value
  const y = dragY.value + panY.value
  const parts: string[] = []
  if (x !== 0 || y !== 0) parts.push(`translate(${x}px, ${y}px)`)
  if (zoomed.value) parts.push(`scale(${ZOOM_SCALE})`)
  return {
    transform: parts.length > 0 ? parts.join(' ') : 'none',
    transformOrigin: `${originX.value}% ${originY.value}%`,
    // Пока палец ведёт кадр, переход выключен: иначе картинка догоняет жест.
    transition: dragging.value ? 'none' : 'transform 200ms ease'
  }
})

/** Свайп вниз приглушает фон — видно, что просмотр уходит. */
const overlayStyle = computed<Record<string, string> | undefined>(() =>
  dragY.value > 0 ? { opacity: `${clamp(1 - dragY.value / 400, 0.35, 1)}` } : undefined
)

// Сменился кадр — гасим зум и сдвиг: следующий кадр открывается целиком.
watch(
  () => props.index,
  () => {
    resetGesture()
    resetZoom()
  }
)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowLeft') emit('prev')
  else if (event.key === 'ArrowRight') emit('next')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.lb-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 10, 14, 0.94);
  animation: lb-fade 0.15s ease-out;
  /* Свайпы по кадру наши, а не браузера: иначе прокрутка страницы под
     оверлеем и «дёргание» картинки забирали бы жест себе. */
  touch-action: none;
}

/* Свайп вниз: фон едет вместе с кадром (значение пишет скрипт). */
.lb-overlay.dragging {
  transition: opacity 200ms ease;
}

@keyframes lb-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.lb-image {
  max-width: 92vw;
  max-height: 86vh;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  user-select: none;
  /* Жесты ведёт скрипт: браузерная прокрутка/зум пальцем не должны мешать. */
  touch-action: none;
  will-change: transform;
}

.lb-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
  /* Кадр стоит в потоке и в разметке вставлен ПОСЛЕ кнопок: без своего слоя
     он рисуется поверх них и забирает нажатие (у кадра `@click.stop`).
     Замер живьём (390×844): центр `.lb-prev` отдавал `elementFromPoint`
     класс `lb-image` — «стрелка назад» не видна и не работает. */
  z-index: 2;
}

.lb-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lb-count {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}

.lb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}

.lb-icon-btn:hover {
  background: rgba(255, 255, 255, 0.24);
}

.lb-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 46px;
  height: 46px;
  /* См. `.lb-topbar`: слой выше кадра. Особенно заметно на телефоне: кадр
     шириной 92vw достаёт до стрелок, и левая уходила под него целиком. */
  z-index: 2;
}

.lb-prev {
  left: 16px;
}

.lb-next {
  right: 16px;
}

/* Ожидание расшифровки E2EE-кадра: кружок в палитре приложения, полоска белая —
   оверлей тёмный. */
.lb-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  --brand-spinner-track: var(--ms-scrim-soft);
}
</style>
