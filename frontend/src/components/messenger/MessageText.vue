<template>
  <!-- Стикер: сообщение из одних эмодзи (1–3) — крупно и без пузыря, как в
       Telegram. Форматирование и ссылки тут не нужны: текста нет. -->
  <span v-if="layout !== 'text'" class="msg-sticker" :class="layout">
    {{ text.trim() }}
  </span>
  <!-- Упоминания @логин подсвечиваем: видно, к кому обращаются -->
  <span v-else-if="text" class="msg-text" :class="{ clamped: isClamped }">
    <template v-for="(part, index) in textParts" :key="index">
      <span v-if="part.type === 'mention'" class="msg-mention">{{ part.value }}</span>
      <a
        v-else-if="part.type === 'link'"
        class="msg-link"
        :href="part.href"
        rel="noopener noreferrer"
        @click.stop.prevent="followMessageLink(part.href)"
        >{{ part.value }}</a
      >
      <!-- Оформление: *жирный*, _курсив_, __подчёркнутый__, `код`,
           ~~зачёркнутый~~, ||спойлер|| -->
      <strong v-else-if="part.type === 'bold'" class="msg-bold">{{ part.value }}</strong>
      <em v-else-if="part.type === 'italic'" class="msg-italic">{{ part.value }}</em>
      <u v-else-if="part.type === 'underline'" class="msg-underline">{{ part.value }}</u>
      <s v-else-if="part.type === 'strike'" class="msg-strike">{{ part.value }}</s>
      <code v-else-if="part.type === 'code'" class="msg-code">{{ part.value }}</code>
      <!-- Цитата: строки, начинающиеся с `>`, — блок с полосой слева (как в Телеграме) -->
      <span v-else-if="part.type === 'quote'" class="msg-quote">{{ part.value }}</span>
      <!-- Совпадение поиска по сообщениям: видно, ЧТО именно нашлось -->
      <mark v-else-if="part.type === 'search'" class="msg-search-hit">{{ part.value }}</mark>
      <!-- Спойлер скрыт, пока по нему не нажмут -->
      <span
        v-else-if="part.type === 'spoiler'"
        class="msg-spoiler"
        :class="{ on: revealedSpoilers.has(index) }"
        :title="revealedSpoilers.has(index) ? undefined : t('Нажмите, чтобы показать')"
        @click.stop="revealSpoiler(index)"
        >{{ part.value }}</span
      >
      <template v-else>{{ part.value }}</template>
    </template>
  </span>
  <!-- Очень длинные тексты показываем свёрнутыми: иначе одна «простыня»
       растягивает ленту на несколько экранов. -->
  <button v-if="canCollapse" type="button" class="msg-more" @click.stop="expanded = !expanded">
    {{ expanded ? t('Свернуть') : t('Показать полностью') }}
  </button>
</template>

<script setup lang="ts">
/**
 * Текст сообщения: стикер-эмодзи, разметка, спойлеры и сворачивание длинного.
 *
 * Вынесено из `MessageRow.vue`: это самая крупная часть пузыря и единственная,
 * которая работает с содержимым текста (разбор разметки, подсветка найденного
 * поиском, раскрытие спойлеров). Строка сообщения теперь отвечает за жест,
 * выделение, реакции и меню — за текст отвечает этот компонент.
 *
 * Классы (`.msg-text`, `.msg-sticker`, `.msg-link`…) оставлены прежними: на них
 * ссылается общий слой оформления (`assets/appearance.css`), поэтому вид не
 * меняется.
 */

import { computed, ref } from 'vue'

import { t } from '@/i18n'
import { followLink } from '@/composables/useExternalLinkGuard'
import { type EmojiLayout } from '@/utils/emoji'
import { highlightQuery, splitMessageText, type MessageTextPart } from '@/utils/mentions'

const props = defineProps<{
  /** Текст сообщения (без учёта вложений). */
  text: string
  /** Крупный ли это «стикер» из эмодзи (`text` — обычный пузырь). */
  layout: EmojiLayout
  /** Запрос поиска по сообщениям: совпадения подсвечиваются. */
  searchQuery?: string | null
}>()

/** С какого размера текст сворачиваем (примерно 12 строк). */
const LONG_TEXT_LIMIT = 600

/**
 * Переносы вокруг цитаты разбор оставляет в её фрагменте: они нужны превью чата
 * и поиску, иначе цитата склеилась бы с текстом рядом. В разметке они лишние —
 * границы блока рисует сам `.msg-quote`, а перенос дал бы пустую строку.
 */
const trimQuotes = (parts: MessageTextPart[]): MessageTextPart[] =>
  parts.map((part) => (part.type === 'quote' ? { ...part, value: part.value.trim() } : part))

const textParts = computed(() =>
  highlightQuery(trimQuotes(splitMessageText(props.text)), props.searchQuery ?? '')
)

/** Спойлеры, которые пользователь уже раскрыл нажатием (по индексу фрагмента). */
const revealedSpoilers = ref<Set<number>>(new Set())

function revealSpoiler(index: number) {
  if (revealedSpoilers.value.has(index)) return
  revealedSpoilers.value = new Set(revealedSpoilers.value).add(index)
}

/**
 * Переход по ссылке из текста.
 *
 * Сами не открываем: свой адрес откроет приложение, а чужой — только после
 * подтверждения «Переходите на внешний сайт» (см. useExternalLinkGuard).
 */
const followMessageLink = (url?: string) => {
  if (url) void followLink(url)
}

const expanded = ref(false)
const canCollapse = computed(() => props.text.length > LONG_TEXT_LIMIT)
const isClamped = computed(() => canCollapse.value && !expanded.value)
</script>

<style scoped>
.msg-sticker {
  display: block;
  line-height: 1.05;
  /* Эмодзи — картинки шрифта, поэтому цвет текста на них не влияет. */
  font-size: calc(44px * var(--ms-text-scale, 1));
  word-break: break-word;
}

/* Три эмодзи — помельче: в ряд они должны влезать на телефоне. */
.msg-sticker.large {
  font-size: calc(32px * var(--ms-text-scale, 1));
}

.msg-text {
  display: block;
  color: var(--ms-bubble-text);
  /* Размер текста сообщений — токен шкалы: он же несёт множитель настройки
     «Размер текста» из оформления. */
  font-size: var(--ms-fs-base);
  line-height: 1.35;
  word-wrap: break-word;
  white-space: pre-wrap;
}

/* Свёрнутый длинный текст: 12 строк и кнопка «Показать полностью». */
.msg-text.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 12;
  overflow: hidden;
}

.msg-more {
  display: block;
  margin: 2px 0 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--ms-accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.msg-more:hover {
  text-decoration: underline;
}

/* Упоминание в тексте: акцентный цвет и полужирное начертание */
.msg-mention {
  color: var(--ms-accent, #2ea25e);
  font-weight: 600;
}

/* Оформление текста (*жирный*, _курсив_, __подчёркнутый__, `код`,
   ~~зачёркнутый~~, ||спойлер||).
   Цвет берём от пузыря: он бывает и своим (зелёным), и чужим (белым). */
.msg-bold {
  font-weight: 700;
}

.msg-italic {
  font-style: italic;
}

/* Подчёркнутый текст (`__текст__`): линия чуть ниже букв, как в Telegram, —
   иначе она слипается с хвостами букв вроде «д» и «у» */
.msg-underline {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.msg-strike {
  text-decoration: line-through;
}

.msg-code {
  font-family: var(--ms-font-mono);
  font-size: 0.92em;
  background: var(--ms-mark-bg);
  border-radius: var(--ms-radius-xs);
  padding: 0 4px;
}

/* Цитата (строки с `>` в начале): блок с полосой слева, как в Telegram.
   Полоса — акцент, текст — приглушённый (цитата это «чужое», а не речь автора).
   Цвет текста НЕ фиксируем, а приглушаем прозрачностью: цвет пузыря выбирает
   пользователь (светлые пресеты вплоть до сиреневого), и подобрать один тон под
   все нечем — а приглушённый цвет пузыря читается на любом из них.
   Внутри строки переносы уже есть (`white-space: pre-wrap` у `.msg-text`),
   поэтому дополнительных переносов не ставим. */
.msg-quote {
  display: block;
  margin: 4px 0;
  padding: 2px 0 2px 10px;
  border-left: 3px solid var(--ms-accent);
  color: inherit;
  opacity: 0.82;
}

/* Совпадение поиска по сообщениям. Фон — предупреждающая подложка (пара
   «текст на --ms-warn-bg» уже проверена по контрасту), цвет текста наследуем:
   пузыри бывают разных цветов, и свой цвет здесь выглядел бы чужеродно. */
.msg-search-hit {
  background: var(--ms-warn-bg);
  color: inherit;
  border-radius: 4px;
  padding: 0 2px;
}

.msg-spoiler {
  background: var(--ms-mark-bg);
  border-radius: var(--ms-radius-xs);
  padding: 0 3px;
  /* Размытие скрывает текст, но не ломает высоту строки, как display: none. */
  filter: blur(3.5px);
  cursor: pointer;
  user-select: none;
}

.msg-spoiler.on {
  background: transparent;
  padding: 0;
  filter: none;
  user-select: text;
}

/* Ссылка в тексте: подчёркнутая, цвет — как у текста (читается в любом пузыре) */
.msg-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  cursor: pointer;
  word-break: break-all;
}

.msg-link:hover {
  opacity: 0.85;
}
</style>
