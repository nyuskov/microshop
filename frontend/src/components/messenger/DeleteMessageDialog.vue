<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="delmsg-card">
      <!-- `row no-wrap items-center` обязателен: без него `q-card-section` —
           блочный контейнер, и кнопка «×» уезжала на вторую строку под заголовок
           (видно было на удалении стикера — заголовок длинный, «×» рядом нет). -->
      <q-card-section class="delmsg-head row no-wrap items-center">
        <div class="delmsg-title">{{ title }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="delmsg-body">
        <p class="delmsg-text">{{ bodyText }}</p>
        <!-- Как в Телеграме: ОДНА галка «Удалить для <имя собеседника>».
             Снята — сообщение уйдёт только у меня, отмечена — и у собеседника
             (в группе — «Для всех»). Двух вариантов-радио нет: выбор тут
             бинарный, и галочка читается как «и ему тоже». -->
        <q-checkbox
          v-if="canDeleteForAll && forAllLabel"
          v-model="forAll"
          color="primary"
          :label="forAllLabel"
          class="delmsg-check"
        />
        <div v-if="forAll && forAllHint" class="delmsg-hint">{{ forAllHint }}</div>
      </q-card-section>
      <q-separator />

      <q-card-actions align="right" class="delmsg-actions">
        <q-btn flat :label="t('Отмена')" @click="emit('close')" />
        <q-btn
          flat
          color="negative"
          :label="t('Удалить')"
          @click="emit('confirm', forAll ? 'all' : 'me')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'

/**
 * Удаление сообщения: «у себя» или «и у собеседника».
 *
 * Раньше удаление было одним и уносило сообщение у ВСЕХ участников, а выбора не
 * было вовсе: человек, желая убрать строку только у себя, невольно удалял её из
 * переписки собеседника. Теперь выбор есть, и сделан он как в Телеграме — ОДНОЙ
 * галкой «Удалить для <имя собеседника>»: снятая — удалить только у себя
 * (безопасное действие по умолчанию), отмеченная — ещё и у него.
 *
 * Галочка показывается только там, где действие возможно: чужое сообщение
 * удалить у всех нельзя (сервер ответит 403), а «для всех» в личном чате — это
 * именно «для собеседника», поэтому название галки приходит сверху готовым
 * (`forAllLabel`: имя собеседника или «Удалить для всех» в группе).
 */

const props = withDefaults(
  defineProps<{
    /** Сколько сообщений удаляем — для заголовка и текста. */
    count?: number
    /** Всё выбранное — мои сообщения (только тогда можно «и у собеседника»). */
    canDeleteForAll?: boolean
    /** Подпись галки: «Удалить для Никиты» / «Удалить для всех» (пусто — нет галки). */
    forAllLabel?: string
    /** Пояснение под отмеченной галкой (что именно произойдёт). */
    forAllHint?: string
  }>(),
  { count: 1, canDeleteForAll: false, forAllLabel: '', forAllHint: '' }
)

const emit = defineEmits<{
  /** Подтвердили: `me` — скрыть у себя, `all` — удалить и у собеседника. */
  confirm: [scope: 'me' | 'all']
  /** Отмена/закрытие окна. */
  close: []
}>()

/** По умолчанию галочка снята: удаляем только у себя — действие безопасное. */
const forAll = ref(false)

const title = computed<string>(() =>
  props.count > 1 ? `Удалить сообщения (${props.count})?` : t('Удалить сообщение?')
)

const bodyText = computed<string>(() =>
  props.count > 1
    ? t('Сообщения исчезнут из вашей переписки.')
    : t('Сообщение исчезнет из вашей переписки.')
)
</script>

<style scoped>
.delmsg-card {
  width: min(400px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.delmsg-head {
  padding: 8px 8px 8px 20px;
}

.delmsg-title {
  font-size: 16px;
  font-weight: 600;
  /* Длинное название не выдавливает «×» за край карточки. */
  min-width: 0;
  overflow-wrap: anywhere;
}

.delmsg-body {
  padding: 10px 20px 12px;
}

.delmsg-text {
  margin: 0 0 10px;
  font-size: 14.5px;
}

.delmsg-check {
  margin-left: -10px;
}

.delmsg-hint {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  margin: 2px 0 0 2px;
}

.delmsg-actions {
  padding: 8px 12px;
}
</style>
