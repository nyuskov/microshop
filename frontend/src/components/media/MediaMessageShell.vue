<template>
  <!-- Общая оболочка медиа-сообщения: плеер (дорожка голосового или круг
       видеосообщения), строка с названием и действиями, затем расшифровка.

       Одна на двоих не случайно (владелец: «сделай, чтобы общим было сообщение
       целиком, как аудио»): раньше у кружка строка с кнопкой была нарисована
       отдельно и расходилась с голосовым и по отступам, и по выравниванию. -->
  <div class="mms">
    <slot name="player" />

    <div class="mms-sub">
      <span v-if="broken" class="mms-error">{{ brokenText }}</span>
      <template v-else>
        <span v-if="name" class="mms-name">
          <slot name="name-icon" />
          <span class="mms-name-text">{{ name }}</span>
        </span>
        <span v-if="sizeLabel" class="mms-size">{{ sizeLabel }}</span>
        <slot name="extra" />
      </template>
      <span class="mms-transcribe">
        <TranscribeButton :message-id="messageId" :src="src" />
      </span>
    </div>

    <TranscriptionBlock :message-id="messageId" :src="src" />
  </div>
</template>

<script setup lang="ts">
/**
 * Оболочка медиа-сообщения (голосовое и кружок).
 *
 * Держит то, что у обоих должно совпадать: строку с названием, кнопку расшифровки
 * справа и сам блок расшифровки. Отличается только «плеер» — его передаёт
 * вызывающий компонент через слот.
 */
import TranscriptionBlock from '@/components/media/TranscriptionBlock.vue'
import TranscribeButton from '@/components/media/TranscribeButton.vue'

defineProps<{
  /** Id сообщения: нужен расшифровке, чтобы помнить текст при перерисовке ленты. */
  messageId: number
  /** Ссылка на файл записи. */
  src: string
  /**
   * Название записи (подпись под плеером). Пусто — строку с названием не рисуем:
   * у кружка имя файла ничего не значит, там остаётся только кнопка в строке.
   */
  name?: string
  /** Размер для подписи (пусто — не показываем). */
  sizeLabel?: string
  /** Запись не читается — вместо названия показываем причину. */
  broken?: boolean
  /** Текст ошибки воспроизведения. */
  brokenText?: string
}>()
</script>

<style scoped>
.mms {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mms-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--ms-fs-xs);
  min-width: 0;
}

.mms-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.mms-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mms-size {
  color: var(--ms-bubble-time, #8a98a3);
  flex-shrink: 0;
}

.mms-error {
  color: var(--ms-danger, #d64545);
  min-width: 0;
}

/* Кнопка расшифровки — в конце строки (у голосового: после названия и скорости). */
.mms-transcribe {
  margin-left: auto;
  flex-shrink: 0;
}
</style>
