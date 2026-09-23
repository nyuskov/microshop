<template>
  <div class="reply-quote" @click.stop="emit('quote-click')">
    <span class="quote-name" :class="{ mine: quote.mine }">{{ quote.name }}</span>
    <span class="quote-text">{{ quote.text }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * Ответ-цитата в пузыре: имя автора и начало исходного сообщения.
 *
 * Вынесено из `MessageRow.vue` (мелкие части пузыря — своими компонентами).
 * Клик по цитате — переход к исходному сообщению; решение об этом принимает
 * лента, поэтому компонент только сообщает о нажатии.
 */

export interface MessageQuote {
  name: string
  mine: boolean
  text: string
}

defineProps<{
  /** Данные цитаты: имя автора, моя ли она и начало текста. */
  quote: MessageQuote
}>()

const emit = defineEmits<{
  /** Перейти к исходному сообщению. */
  (e: 'quote-click'): void
}>()
</script>

<style scoped>
/* Ответ-цитата */
.reply-quote {
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--ms-icon) 8%, transparent);
  border-left: 3px solid var(--ms-info);
  border-radius: var(--ms-radius-xs);
  padding: 5px 9px;
  margin-bottom: 5px;
  cursor: pointer;
  min-width: 120px;
}

/* У своих сообщений (пузырь-акцент) полоска цитаты акцентная, а не «инфо». */
.msg.out .reply-quote {
  border-left-color: var(--ms-accent);
}

.quote-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ms-info);
}

.quote-name.mine {
  color: var(--ms-accent);
}

.quote-text {
  font-size: 13px;
  color: var(--ms-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
