<template>
  <Teleport to="body">
    <div v-if="pending" class="ms-overlay" @mousedown.self="answer(false)">
      <div
        ref="trapContainer"
        class="ms-overlay-card ms-overlay-card--sm el-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="el-title"
        tabindex="-1"
      >
        <span class="el-icon">
          <q-icon :name="icon('warning')" size="22px" />
        </span>
        <h2 id="el-title" class="el-title">{{ t('Переход на внешний сайт') }}</h2>
        <p class="el-text">
          {{
            t(
              'Ссылка ведёт за пределы Pismo. Мы не проверяем чужие сайты и не отвечаем за их содержимое.'
            )
          }}
        </p>
        <div class="el-target">
          <span class="el-host">{{ pending.host }}</span>
          <span class="el-url">{{ prettyUrl }}</span>
        </div>
        <div class="el-actions">
          <button type="button" class="el-btn ghost" @click="answer(false)">
            {{ t('Отмена') }}
          </button>
          <button type="button" class="el-btn go" @click="go">
            <q-icon :name="icon('share')" size="16px" /> {{ t('Перейти') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { icon } from '@/utils/icons'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { useExternalLinkDialog } from '@/composables/useExternalLinkGuard'
import { t } from '@/i18n'

const { pending, answer } = useExternalLinkDialog()

// Спрашиваем подтверждение — значит удерживаем фокус: иначе Tab уводит на сайт
// под окном, а ответ «Перейти/Отмена» требует осознанного выбора.
const { container: trapContainer } = useFocusTrap(() => pending.value !== null)

/** Полный адрес обрезаем: длинные ссылки ломали бы вёрстку. */
const prettyUrl = computed<string>(() => {
  const url = pending.value?.url ?? ''
  return url.length > 90 ? `${url.slice(0, 89)}…` : url
})

/** Esc — как «Отмена»: привычный способ закрыть окно. */
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && pending.value) answer(false)
}

/**
 * «Перейти»: окно открываем прямо здесь.
 *
 * Браузер разрешает новое окно только в ответ на действие пользователя, а после
 * `await` (вопрос-ответ) этот момент уже упущен — поэтому окно создаём сразу,
 * а адрес в него подставим после ответа (см. `openExternalUrl`).
 */
const go = () => {
  const popup = typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
  answer(true, popup)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* Подложка, центрирование, лист снизу на телефоне, ширина, фон, радиус,
   тень и появление окна — в общем слое (assets/overlays.css, `.ms-overlay*`).
   Здесь остаётся только то, что специфично для этого окна. */
.el-card {
  padding: var(--ms-dialog-pad);
}

.el-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--ms-accent-soft, #e3f2e5);
  color: var(--ms-accent, #2ea25e);
}

.el-title {
  margin: 12px 0 6px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ms-text-strong, #141d26);
}

.el-text {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ms-muted, #71808d);
}

.el-target {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2, #f0f2f5);
  overflow: hidden;
}

.el-host {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text-strong, #141d26);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.el-url {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.el-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.el-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 0;
  border-radius: var(--ms-radius-sm);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.el-btn.ghost {
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
}

.el-btn.ghost:hover {
  background: var(--ms-hover, #e8ebef);
}

.el-btn.go {
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
}

.el-btn.go:hover {
  background: var(--ms-accent-strong, #288e52);
}
</style>
