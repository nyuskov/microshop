<template>
  <ErrorScreen
    v-if="maintenanceActive"
    overlay
    code="503"
    :title="t('Идут технические работы')"
    :text="maintenanceText"
  >
    <template #actions>
      <q-btn
        unelevated
        no-caps
        color="primary"
        :loading="checking"
        :label="t('Проверить снова')"
        @click="retry"
      />
    </template>
    <template #foot>
      <span>{{ t('Работы обычно занимают несколько минут — страница обновится сама.') }}</span>
    </template>
  </ErrorScreen>
</template>

<script setup lang="ts">
/**
 * Экран «Идут технические работы» — вместо приложения, пока включён режим.
 *
 * Режим включает администратор сервиса (админская панель → «Технические
 * работы»): сервер начинает отвечать 503 с кодом `maintenance`, а приложение
 * показывает этот экран поверх всего — включая экран входа, потому что во время
 * техработ не работает ничего, кроме проверок живости и входа администратора.
 *
 * Вид общий с 404/500 (`ErrorScreen`) и статическими страницами nginx — чтобы
 * «сервис недоступен» не выглядело как чужой сайт. Почему 503: это честный код
 * ответа сервера, а не украшение.
 */
import { ref } from 'vue'

import ErrorScreen from '@/components/common/ErrorScreen.vue'
import { fetchMaintenanceStatus, realMaintenanceEnabled } from '@/services/maintenance'
import { hideMaintenance, maintenanceActive, maintenanceText } from '@/utils/maintenance'
import { t } from '@/i18n'

const checking = ref(false)

/**
 * Ручная проверка: если работы уже закончились — снимаем экран и перезагружаем
 * страницу (приложение за экраном стояло без данных, см. useMaintenanceWatch).
 *
 * Состояние берём через `realMaintenanceEnabled`: администратору сервер отдаёт
 * `enabled=false` (чтобы заглушка не закрывала его в старом клиенте), и по этому
 * полю кнопка всегда «видела бы» окончание работ.
 */
const retry = async () => {
  checking.value = true
  try {
    const status = await fetchMaintenanceStatus()
    if (!realMaintenanceEnabled(status)) {
      hideMaintenance()
      window.location.reload()
    }
  } catch {
    // Не ответил — значит работы ещё идут (или связи нет): экран оставляем.
  } finally {
    checking.value = false
  }
}
</script>
