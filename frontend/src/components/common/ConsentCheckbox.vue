<template>
  <label class="consent" :class="{ 'consent--invalid': invalid }">
    <input
      class="consent-box"
      type="checkbox"
      :checked="modelValue"
      :aria-invalid="invalid || undefined"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="consent-text">
      Я принимаю
      <a href="/privacy.html" target="_blank" rel="noopener" @click.stop
        >политику конфиденциальности</a
      >,
      <a href="/terms.html" target="_blank" rel="noopener" @click.stop
        >пользовательское соглашение</a
      >
      и
      <a href="/community.html" target="_blank" rel="noopener" @click.stop>правила сообщества</a>, а
      также даю согласие на обработку персональных данных.
    </span>
  </label>
</template>

<script setup lang="ts">
/**
 * Галка принятия документов сервиса — для регистрации.
 *
 * Без неё аккаунт не создаётся (проверяет вызывающий экран): согласие должно
 * быть явным действием человека, а не строчкой мелкого текста под кнопкой.
 * Ссылки открываются в новой вкладке и не переключают саму галку
 * (`@click.stop` — иначе клик по ссылке внутри `<label>` отметил бы чекбокс).
 */
defineProps<{
  /** Отмечена ли галка. */
  modelValue: boolean
  /** Не отмечена там, где обязательна — подсвечиваем рамку. */
  invalid?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
</script>

<style scoped>
.consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 14px 0 0;
  text-align: left;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ms-text);
  cursor: pointer;
}

.consent-box {
  flex: none;
  width: 18px;
  height: 18px;
  margin: 1px 0 0;
  accent-color: var(--ms-accent);
  cursor: pointer;
}

.consent-text a {
  color: var(--ms-accent);
  text-decoration: none;
}

.consent-text a:hover {
  text-decoration: underline;
}

/* Не отмечена, а дальше нельзя: подсвечиваем саму галку — текст ошибки
   показывается штатным сообщением формы. */
.consent--invalid .consent-box {
  outline: 2px solid var(--ms-danger);
  outline-offset: 1px;
  border-radius: 4px;
}
</style>
