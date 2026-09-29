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
          :title="mini ? t('Показать истории') : t('Моя история')"
          :aria-label="mini ? t('Показать истории') : t('Моя история')"
          @click="onMineClick"
        >
          <span
            class="story-avatar"
            :class="{ empty: !mine }"
            :style="mine ? avatarStyle(myName) : undefined"
          >
            <!-- Своей истории нет — в кружке «+», а не аватар/инициалы: рядом
                 в шапке стоит аватар профиля, и два одинаковых кружка
                 читались как один и тот же элемент. Поэтому «+» важнее
                 аватара. -->
            <q-icon v-if="!mine" :name="icon('add')" class="story-avatar-add" aria-hidden="true" />
            <img v-else-if="myAvatar" :src="myAvatar" alt="" loading="lazy" decoding="async" />
            <template v-else>{{ myInitials }}</template>
          </span>
        </button>
        <button
          v-if="!mini && !publishing"
          class="story-add"
          type="button"
          :title="t('Добавить историю')"
          @click="pickFile"
        >
          <q-icon :name="icon('add')" size="14px" />
        </button>
        <span v-else-if="!mini" class="story-add busy"><span class="mini-spinner"></span></span>
        <span class="story-name">{{ t('Моя история') }}</span>
      </div>

      <!-- Истории других: точка-кольцо, если есть непросмотренные.
           В шапке кружки находят друг на друга: следующий уходит ПОД предыдущий,
           поэтому z-index убывает слева направо (как в Telegram). -->
      <button
        v-for="(group, index) in visibleOthers"
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
        {{ t('Здесь появятся истории друзей — они живут 24 часа.') }}
      </p>
    </div>

    <!-- Счётчик «+N»: сколько историй НЕ влезло в сжатый ряд. Ряд занимает всю
         свободную ширину до правых значков (сколько влезло — считает замер в
         скрипте), и по кружкам без счётчика не понять, что за краем есть ещё
         люди (владелец: «чтобы понятно было, что их не две, а больше»). Лежит
         ПОВЕРХ полосы у её правого края и ширины НЕ занимает: в потоке он отнимал
         ~20 px у надписи в середине шапки, и та усекалась (владелец: «только
         чтобы он пространство не занимал типа чтобы тихие часы больше
         умещались»). Тап — как по кружку: раскрывает полосу, где лимита нет. -->
    <button
      v-if="mini && hiddenOthers > 0"
      class="story-more"
      type="button"
      :title="t('Ещё {count} — показать всю полосу', { count: hiddenOthers })"
      :aria-label="t('Ещё {count} — показать всю полосу', { count: hiddenOthers })"
      @click="emit('toggle-expand')"
    >
      +{{ hiddenOthers }}
    </button>

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
            <div class="story-caption-title">{{ t('Новая история') }}</div>
            <p class="story-caption-hint">
              {{ pendingFile?.name }} — можно добавить подпись. История исчезнет через 24 часа.
            </p>
            <input
              v-model="caption"
              class="story-caption-input"
              type="text"
              maxlength="140"
              :placeholder="t('Подпись (необязательно)')"
              @keyup.enter="publish"
            />
            <!-- Проверка видео на месте: браузер бывает не в силах его проиграть,
                 и тогда историю перекодирует сервер (иначе был бы чёрный экран). -->
            <p v-if="videoNeedsTranscode" class="story-caption-warning">
              {{
                t(
                  'Это видео не проигрывается в браузере — его перекодирует сервер. Это может занять до минуты.'
                )
              }}
            </p>
            <p v-if="stories.error" class="story-caption-error">{{ stories.error }}</p>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat :label="t('Отмена')" @click="cancelPublish" />
            <q-btn
              color="primary"
              unelevated
              :label="t('Опубликовать')"
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
import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, nextTick, ref, watch } from 'vue'
import { Notify } from 'quasar'

import { mediaUrl } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { useStoriesStore } from '@/stores/stories'
import { useHScroll } from '@/composables/useHScroll'
import { useMobileLayer } from '@/composables/useMobileOverlay'
import type { StoryGroup } from '@/services/stories'
import {
  countVisibleCells,
  firstUnseenStoryId,
  HEADER_STORIES_MAX,
  headerHiddenStoryGroups,
  headerStoryGroups,
  probeVideoPlayback,
  type VideoProbe
} from '@/utils/stories'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'

const emit = defineEmits<{
  (e: 'open-story', storyId: number): void
  /** Нажатие по сжатым историям в шапке — раскрыть полосу под шапкой. */
  (e: 'toggle-expand'): void
  /**
   * Сколько историй не влезло в сжатый ряд (0 — влезли все).
   *
   * Считает ТОЛЬКО компонент: он знает и ширину коробки, и прямоугольники
   * кружков. Шапке число нужно для отступа надписи в середине (счётчик «+N»
   * вынут из потока и заходит в её коробку).
   */
  (e: 'hidden-count', count: number): void
}>()

const props = withDefaults(
  defineProps<{
    /** Сжатый вид для шапки: мелкие кружки без подписей и без выбора файла. */
    mini?: boolean
    /** Полоса историй раскрыта — кружок в шапке подсвечен (для mini). */
    expanded?: boolean
    /**
     * Предел кружков в сжатом ряду, считая «Мою историю» (см.
     * `utils/stories.headerStoriesLimit`): с подсказкой в середине шапки — 2, без
     * неё — потолок разметки. Сколько из них реально влезет, решает замер: ряд
     * тянется до правых значков, а их ширину знает только раскладка.
     */
    limit?: number
  }>(),
  { mini: false, expanded: false, limit: 0 }
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
  emit('open-story', firstUnseenStoryId(group))
}

const stories = useStoriesStore()
const authStore = useAuthStore()

/**
 * Сколько кружков ряда видно ЦЕЛИКОМ — по замеру их прямоугольников.
 *
 * Ряд тянется до правых значков, а подсказка в середине отдаёт ему ширину
 * (сжимается первой), поэтому «сколько влезло» знает только раскладка.
 * Обрезанный у края кружок не считаем — он же подсказывает, что есть ещё.
 */
const visibleCells = ref(HEADER_STORIES_MAX)

const measureVisible = () => {
  const wrap = stripEl.value
  if (!props.mini || !wrap) return
  const box = wrap.getBoundingClientRect()
  // Полоса скрыта (закрытый ящик/нулевая ширина) — прежнее число честнее нуля:
  // замер с нулевой коробкой назвал бы скрытыми все истории и ряд залип бы с «+N».
  if (box.width <= 0) return
  const cells = [...wrap.querySelectorAll('.story-cell')].map((cell) =>
    cell.getBoundingClientRect()
  )
  visibleCells.value = countVisibleCells(cells, box)
}

/** Предел ряда: правило владельца (с надписью в середине — короткий, иначе потолок разметки). */
const rowLimit = computed(() => (props.limit > 0 ? props.limit : HEADER_STORIES_MAX))

/**
 * Сколько кружков ВИДНО в коробке полосы — число для счётчика «+N».
 *
 * ГРАБЛЯ (29.09.2026, владелец: «вылезает +1, хотя свободное место есть… они
 * должны все показываться полностью»): замер сначала решал, СКОЛЬКО кружков
 * нарисовать (через `capacity`), а сам замер шёл по уже нарисованным. Круг
 * замыкался: замер бежал сразу после старта, когда лента ещё не пришла и в ряду
 * стояла только «Моя история», — он возвращал 1, ряд по этому числу обрезался до
 * одного кружка, и вырасти обратно было уже нечем (мерить нечего). Теперь
 * рисуем по пределу (`rowLimit`), а замер только называет число за краем: у
 * полосы своя прокрутка, лишние кружки не теряются.
 */
const capacity = computed(() => Math.max(1, Math.min(rowLimit.value, visibleCells.value)))

/**
 * Истории других, которые рисует сжатый ряд в шапке.
 *
 * Ряд ограничен ТОЛЬКО пределом: сколько из нарисованных дойдёт до глаз, решает
 * раскладка (коробка полосы), а не замер — иначе получается тот самый круг
 * «замер по нарисованному». Лишние кружки уезжают за край коробки: полосу можно
 * прокрутить, а о них говорит счётчик «+N». Вся раскрытая полоса — без предела.
 */
const visibleOthers = computed(() =>
  props.mini ? headerStoryGroups(stories.others, rowLimit.value) : stories.others
)

/**
 * Сколько авторов не влезло в сжатый ряд шапки — их число показывает счётчик
 * «+N» рядом с полосой. В раскрытой полосе ограничения нет, поэтому там 0.
 */
const hiddenOthers = computed(() =>
  props.mini ? headerHiddenStoryGroups(stories.others, capacity.value) : 0
)

// Шапка держит по этому числу отступ надписи в середине (см. `with-more`).
watch(hiddenOthers, (count) => emit('hidden-count', count), { immediate: true })

// Замер перерисовываем на монтировании, при смене числа групп и при изменении
// ширины полосы (её отдаёт шапка: на узком экране меньше, на широком больше).
let stripObserver: ResizeObserver | null = null

onMounted(() => {
  void nextTick(measureVisible)
  const wrap = stripEl.value
  // В jsdom (тесты) ResizeObserver нет — меряем один раз и по изменениям групп.
  if (wrap && typeof ResizeObserver !== 'undefined') {
    stripObserver = new ResizeObserver(() => measureVisible())
    stripObserver.observe(wrap)
  }
})

onBeforeUnmount(() => {
  stripObserver?.disconnect()
  stripObserver = null
})

watch(
  () => [props.mini, props.expanded, stories.groups.length] as const,
  () => void nextTick(measureVisible)
)

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

/**
 * Проверка выбранного видео в браузере. Запускается сразу при выборе файла (это
 * быстро, файл локальный), а `publish` дожидается результата — иначе человек
 * успел бы нажать «Опубликовать» раньше, чем проверка закончится.
 */
let videoProbe: Promise<VideoProbe> | null = null
const videoNeedsTranscode = ref(false)

const mine = computed(() => stories.mine)

const myAvatar = computed(() => {
  const me = authStore.current_user
  const path = me?.avatar_thumb_url || me?.avatar_url
  return path ? mediaUrl(path) : ''
})

const myInitials = computed(() => {
  const user = authStore.current_user
  const name = user ? displayName(user) : ''
  return name ? initials(name) : t('Я')
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
    Notify.create({ message: t('История может быть фото или видео'), timeout: 3000 })
    return
  }
  pendingFile.value = file
  caption.value = ''
  videoProbe = null
  videoNeedsTranscode.value = false
  if (file.type.startsWith('video/')) {
    // «unknown» (не дождались первого кадра) — не повод предупреждать: решение
    // всё равно принимает сервер по кодекам файла.
    const probe = probeVideoPlayback(file)
    videoProbe = probe
    void probe.then((result) => {
      if (pendingFile.value === file) videoNeedsTranscode.value = result === 'unsupported'
    })
  }
  captionOpen.value = true
}

const cancelPublish = () => {
  captionOpen.value = false
  pendingFile.value = null
  caption.value = ''
  videoProbe = null
  videoNeedsTranscode.value = false
}

// Диалог подписи к новой истории — слой общего стека (см. `useMobileOverlay`):
// «назад» закрывает его, а не выходит из приложения.
useMobileLayer(() => captionOpen.value, cancelPublish)

const publish = async () => {
  const file = pendingFile.value
  if (!file) return
  // Ждём проверку видео (её могли запустить секунду назад): если браузер файл не
  // играет, просим сервер перекодировать — иначе зрители увидят чёрный экран.
  const probe = file.type.startsWith('video/') ? videoProbe : null
  const result = probe ? await probe : 'unknown'
  const ok = await stories.publish(file, caption.value.trim(), {
    transcode: result === 'unsupported'
  })
  if (!ok) {
    Notify.create({
      message: stories.error || t('Не удалось опубликовать историю'),
      timeout: 4000
    })
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
  /* Ряд листается и может уехать за край, а счётчик «+N» должен остаться на
     виду — поэтому он не в полосе, а ПОВЕРХ неё: позиционируется от этой
     коробки (см. `.mini .story-more`). */
  display: flex;
  align-items: center;
  position: relative;
}

/* Счётчик «+N» — чип с числом у правого края полосы, без подложки.
   Владелец: сначала «+1 как-то плотнее надо и без кружка», потом пробовали
   бейдж с акцентным фоном, как у непрочитанных (`assets/rows.css` → `.unread-badge`) —
   вердикт: «без фона лучше»; серый цвет — «не серым».
   Кегль и вес — как у бейджа непрочитанных (`var(--ms-fs-xs)`, 700), но через токен:
   он учитывает настройку «размер текста» в профиле.
   z-index выше кружков (у них 95…100): чип не должен уехать под аватар. */
.mini .story-more {
  /* ИЗ ПОТОКА ВЫНУТ: в потоке счётчик отнимал ~20 px у середины шапки, и
     надпись там усекалась (владелец: «только чтобы он пространство не занимал
     типа чтобы тихие часы больше умещались» — на скриншоте с телефона стояло
     «Quiet h…»). Теперь эта ширина достаётся надписи: полоса занимает всю
     коробку, а чип висит у её правого края и в раскладке не участвует. */
  position: absolute;
  top: 0;
  /* Сдвиг вправо от коробки полосы — владелец подбирал вживую: «чуть накрывая»,
     «правее», «ещё правее», потом обратно «левее более вплотную к историям».
     Итог −18 px: цифра стоит вплотную к ободку крайнего кружка — её левый край
     на 2 px левее края коробки полосы, то есть ровно по её внутреннему краю, где
     и идёт ореол. Ширины кнопка не занимает: надпись в середине стоит по центру
     своей коробки, и её левый край всё равно остаётся свободным. */
  right: -18px;
  bottom: 0;
  z-index: 101;
  display: flex;
  /* Цифра — по ЦЕНТРУ кружка по вертикали и вплотную к правому краю шапки
     (владелец: «сделай значок +1 по центру»; раньше стояла по верхней точке
     кружка — из ряда значков выбивалась).
     40 px — высота ячейки кружка (`.mini .story-cell`), а круг 34 px центрирован
     в ней: центр коробки счётчика совпадает с центром кружка и со строкой
     соседних значков шапки. Коробка растянута по высоте полосы (ячейка 40 px +
     отступы полосы 2 px), а цифру в ней центрирует `align-items`. */
  align-items: center;
  justify-content: center;
  /* Отступы внутри кнопки — только под палец: своей формы у неё нет (ни рамки,
     ни подложки), в разметке — одна цифра, но цель получается ~26 px в ширину.
     Вертикаль не при чём: коробка растянута по высоте полосы. */
  padding: 0 6px;
  border: none;
  background: none;
  /* Цвет — как у ЗНАЧКОВ рядом, а не у ободка кружков (владелец, последняя
     правка: «светлее как значки чатов и т.п.»): `--ms-icon` — ровно тот токен,
     которым нарисованы кнопки-значки шапки (`assets/appearance.css` → `.icon-btn`:
     поиск, контакты — соседи кружков). В тёмной теме (в приложении она по
     умолчанию) он заметно светлее прежнего `--ms-muted-3`, который владелец
     и просил облегчить; проверка контраста (`scripts/check-contrast.mjs`) держит
     `--ms-icon` по норме 3:1 в обеих темах.
     Раскрытая полоса (`expanded`) — по-прежнему акцент, как у активного ореола
     (владелец: «когда активная — активна, когда неактивная — цветом ободка»). */
  color: var(--ms-icon);
  /* Кегль и вес — как у бейджа непрочитанных в списке чатов (`assets/rows.css`
     → `.unread-badge`: `var(--ms-fs-xs)` = 11.5 px при масштабе текста 1, вес 700).
     Через токен, а не числом: он учитывает настройку «размер текста» в профиле.
     Сначала было 14 px, потом 12 px — владелец: «шрифт цифры поменьше, слишком
     большой», затем «кегль у этой цифры как и у непрочитанных?» */
  font-size: var(--ms-fs-xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  /* ГЛАВНОЕ: никакой подложки. На телефоне её рисовал сам браузер (серая
     подсветка тапа), а не наш CSS — у всех остальных кнопок ряда она отключена;
     счётчик её забыли. Бейдж с фоном пробовали и отклонили: «не, без фона лучше». */
  -webkit-tap-highlight-color: transparent;
}

/* Рамки у счётчика НЕТ — как и подложки. Владелец попробовал рамку и отказался:
   «сделай его ещё рамку округлую» → «обод должен быть круг, а не овал» (таблетка
   по содержимому выходила овалом) → «давай без обводки так плохо». Осталась голая
   цифра: цветом значков шапки, кеглем бейджа непрочитанных. Возвращать сюда
   обводку, подложку или круг — значит повторить уже отклонённый вариант.
   Раскрытая полоса подсвечивает цифру акцентом (правило ниже). */

/* Полоса раскрыта — цифра «активна», как ореол активного кружка. */
.mini.expanded .story-more {
  color: var(--ms-accent);
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
   влево на 28 px (шаг 12 px) и уходит под предыдущий (z-index задан в разметке).
   Владелец просил плотнее четыре раза (было 13, потом 20, потом 24, теперь 28):
   так шесть кружков вместе с кнопками влезают в шапку, а ряд читается одним
   блоком. Нажатие при таком наложении ловит видимая часть кружка — 12 px
   (граница разумного: дальше цель по палец становится слишком узкой). */
.mini .story-cell {
  position: relative;
}

.mini .story-cell + .story-cell {
  margin-left: -28px;
}

/* Ячейка — 40 px (как аватар профиля в шапке и круглые кнопки до 600px):
   внутри кружок 34 px по центру, а линия ореола идёт по краю ячейки. Было 34 px,
   но по такой цели палец промахивался чаще, чем по соседним кнопкам 38–40 px.
   Зазор до картинки — 2 px (≈0.5 мм). Центрирование задано явно: кнопка по
   умолчанию ставит круг в угол. */
.mini .story-avatar-btn,
.mini .story-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
}

.mini .story-avatar {
  width: 34px;
  height: 34px;
}

/* Кружок в шапке: сам аватар жёстко обрезан по кругу (clip-path работает
   даже когда браузер рисует кнопку отдельным слоем — при нажатии), а тонкая
   линия ореола живёт отдельным слоем (::after) и обрезкой не затрагивается. */
.mini .story-avatar {
  border: none;
  /* Линия по кругу — ВНУТРИ кружка (inset-тень), внешних теней нет: они
     складывались с линией. См. подробности ниже, у правил ореола. */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ms-muted-3) 45%, transparent);
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

/* Линия кружка — внутри него, а не по краю ЯЧЕЙКИ.
   Раньше линия рисовалась отдельным слоем на ячейке (`::after`, `inset: 0`):
   ячейка 40 px, кружок 34 px — значит линия шла на 3 px НАРУЖУ от картинки.
   В плотном ряду (шаг 12 px) её левая дуга выходила из-под соседнего кружка
   серпом и читалась как подложка-тень позади истории (владелец, 26.09.2026:
   «тень… она даже без подсказки есть», «подложка затеняет истории»).
   Внутренняя линия не выходит за кружок и ничего не затеняет; цвет тот же
   (полупрозрачный серый: плотный `--ms-muted-3` был слишком тёмный, а
   `--ms-border` сливался с фоном). */

/* Непросмотренное — та же линия акцентом, толще. При нажатии цвет не меняется:
   ореол постоянный, как на образце. */
.mini .story-avatar.unseen {
  box-shadow: inset 0 0 0 2px var(--ms-accent);
}

/* Своей истории нет — в кружке «+» (раньше в углу висел маленький значок, а в
   кружке стояли инициалы — рядом в шапке те же буквы у аватара профиля, и два
   кружка путались). Мягкая акцентная подложка говорит, что это действие. */
.story-avatar-add {
  font-size: 20px;
  line-height: 1;
}

/* Полоса историй раскрыта: кружок в шапке подсвечен — как значок поиска в
   открытом состоянии. Тот же ореол, но толще: состояние читается сразу. */
.mini.expanded .story-avatar {
  box-shadow: inset 0 0 0 2px var(--ms-accent);
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
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
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

/* Предупреждение, а не ошибка: публикация возможна, просто её ждёт
   перекодирование на сервере (`core/video_transcode.py`). */
.story-caption-warning {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ms-warn);
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
