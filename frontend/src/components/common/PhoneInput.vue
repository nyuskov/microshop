<template>
  <q-input
    :for="id"
    ref="field"
    :model-value="modelValue"
    outlined
    class="phone-input"
    :placeholder="placeholder"
    :disable="disable"
    inputmode="tel"
    autocomplete="tel"
    :aria-label="ariaLabel"
    hide-bottom-space
    @update:model-value="onInput"
    @keyup.enter="emit('enter')"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { formatPhoneInput } from '@/utils/phone'

/**
 * Поле ввода телефона — единственное место, где номер превращается в маску.
 *
 * Почему не `mask` из Quasar (было так на экране входа): та маска ждёт РОВНО
 * 10 локальных цифр и не знает про код страны, поэтому вставка номера в
 * привычном виде («+7 900 111-00-01», «8 900 111 00 01») молча превращала его
 * в другой номер — последняя цифра отбрасывалась, а результат оставался
 * «валидным». Здесь ввод сначала разбирается целиком (`localPhoneDigits`),
 * а потом форматируется; каретка возвращается на ту же цифру.
 *
 * Компонент «глупый»: наружу отдаёт уже отформатированную строку, из которой
 * `formatPhoneForBackend()` делает `+7XXXXXXXXXX`.
 */
const props = withDefaults(
  defineProps<{
    id?: string
    /** Отформатированное значение поля (`+7 (900) 111-00-01`). */
    modelValue: string
    placeholder?: string
    ariaLabel?: string
    disable?: boolean
  }>(),
  {
    id: undefined,
    placeholder: '+7 (___) ___-__-__',
    ariaLabel: 'Номер телефона',
    disable: false
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'enter'): void
}>()

/** Поле Quasar: нужен доступ к настоящему `<input>`, чтобы вернуть каретку. */
const field = ref<{ getNativeElement: () => HTMLInputElement | null } | null>(null)

const nativeInput = (): HTMLInputElement | null => field.value?.getNativeElement() ?? null

/** Приводит значение поля к строке: Quasar отдаёт `string | number | null`. */
function asText(raw: string | number | null): string {
  if (typeof raw === 'string') return raw
  return raw === null ? '' : String(raw)
}

function onInput(raw: string | number | null) {
  const input = nativeInput()
  const next = formatPhoneInput(asText(raw), input ? input.selectionStart : null)

  if (input) {
    // DOM правим сами (а не ждём перерисовки Vue): иначе отброшенный символ
    // («+», буква, лишняя цифра) остался бы висеть в поле до следующего ввода.
    if (input.value !== next.value) input.value = next.value
    if (next.caret !== null) input.setSelectionRange(next.caret, next.caret)
  }
  if (next.value !== props.modelValue) emit('update:modelValue', next.value)
}
</script>
