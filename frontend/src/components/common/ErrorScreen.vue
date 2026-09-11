<template>
  <div
    class="error-screen"
    :class="[`error-screen--${tone}`, { 'error-screen--overlay': overlay }]"
    :role="overlay ? 'alertdialog' : undefined"
    :aria-modal="overlay ? 'true' : undefined"
    :aria-labelledby="titleId"
  >
    <header class="error-screen__top">
      <span class="error-screen__logo" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <g fill="#ffffff">
            <rect x="12.8" y="17.28" width="38.4" height="29.44" rx="7.65" />
            <path d="M19.33 46.13 L12.03 52.9 L26.62 46.43 Z" />
          </g>
          <path
            d="M17.02 21.7 L32 29.94 L46.98 21.7"
            fill="none"
            stroke="#3a32c9"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="error-screen__wordmark">Pismo</span>
    </header>

    <div class="error-screen__hero">
      <p class="error-screen__code">{{ code }}</p>
      <h1 :id="titleId" class="error-screen__title">{{ title }}</h1>
      <p class="error-screen__text">{{ text }}</p>
      <div v-if="$slots.extra" class="error-screen__extra">
        <slot name="extra" />
      </div>
      <div v-if="$slots.actions" class="error-screen__actions">
        <slot name="actions" />
      </div>
    </div>

    <footer v-if="$slots.foot" class="error-screen__foot">
      <slot name="foot" />
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * Полноэкранный экран ошибки — общий для «Страница не найдена» (404) и для
 * фатального сбоя приложения (500).
 *
 * Раньше оба показывали маленькую карточку по центру: на большом экране она
 * выглядела случайным окошком, а не состоянием всего приложения. Здесь фон, код
 * и текст занимают весь вьюпорт, действия идут под текстом, подпись — внизу.
 * Тот же вид у статических `public/404.html` и `public/500.html` (их отдаёт
 * nginx, когда само приложение не поднялось).
 */
import { useId } from 'vue'

withDefaults(
  defineProps<{
    /** Код состояния: «404» / «500». Показывается крупно. */
    code: string
    /** Короткий заголовок («Страница не найдена»). */
    title: string
    /** Пояснение в одну-две строки: что случилось и что делать. */
    text: string
    /** Оформление кода: акцент приложения или тревожный красный. */
    tone?: 'brand' | 'danger'
    /** Экран поверх всего приложения (фатальная ошибка), а не отдельная страница. */
    overlay?: boolean
  }>(),
  { tone: 'brand', overlay: false }
)

const titleId = useId()
</script>

<style scoped>
/* Токены темы дают светлый и тёмный вид без отдельной ветки стилей. */
.error-screen {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: clamp(18px, 4vh, 40px);
  min-height: 100vh;
  /* dvh, а не vh: на телефоне адресная строка «съедает» низ экрана. */
  min-height: 100dvh;
  padding: max(clamp(18px, 3vh, 32px), env(safe-area-inset-top)) clamp(16px, 4vw, 48px)
    max(clamp(18px, 3vh, 32px), env(safe-area-inset-bottom));
  background-color: var(--ms-body, #eef1f4);
  /* Мягкое свечение сверху + «обои» в точку, как в чате: экран не выглядит
     пустым даже на широком мониторе. */
  background-image: var(--glow), var(--ms-chat-dots, none);
  background-repeat: no-repeat, repeat;
  background-size:
    100% 64vh,
    22px 22px;
  color: var(--ms-text, #1c2733);
  text-align: center;
}

.error-screen--brand {
  --glow: radial-gradient(
    120% 72% at 50% -18%,
    color-mix(in srgb, var(--ms-accent, #2ea25e) 16%, transparent),
    transparent 62%
  );
  --code-a: var(--ms-accent, #2ea25e);
  --code-b: var(--ms-accent-strong, #22804a);
}

.error-screen--danger {
  --glow: radial-gradient(
    120% 72% at 50% -18%,
    color-mix(in srgb, var(--ms-danger, #d64545) 16%, transparent),
    transparent 62%
  );
  --code-a: var(--ms-danger, #d64545);
  --code-b: var(--ms-warn, #b8860b);
}

/* Фатальная ошибка перекрывает приложение целиком, а не встраивается в поток. */
.error-screen--overlay {
  position: fixed;
  inset: 0;
  z-index: 40000;
  overflow: auto;
}

.error-screen__top {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.error-screen__logo {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(160deg, #7b72ff, #3a32c9);
  box-shadow: 0 10px 24px -12px #6c63ff;
}

.error-screen__logo svg {
  width: 22px;
  height: 22px;
}

.error-screen__wordmark {
  font-family: var(--ms-font-display, inherit);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.error-screen__hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(8px, 1.4vh, 14px);
  padding: clamp(16px, 5vh, 48px) 0;
}

.error-screen__code {
  margin: 0;
  font-family: var(--ms-font-display, inherit);
  font-size: clamp(84px, 19vw, 190px);
  font-weight: 700;
  line-height: 0.86;
  letter-spacing: -0.05em;
  color: var(--code-a);
}

/* Градиентная цифра — только там, где background-clip:text поддерживают:
   иначе текст остался бы прозрачным и невидимым. */
@supports (background-clip: text) or (-webkit-background-clip: text) {
  .error-screen__code {
    background-image: linear-gradient(165deg, var(--code-a), var(--code-b));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}

.error-screen__title {
  margin: 0;
  max-width: 24ch;
  font-family: var(--ms-font-display, inherit);
  font-size: clamp(23px, 3.4vw, 34px);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.015em;
  text-wrap: balance;
}

.error-screen__text {
  margin: 0;
  max-width: 46ch;
  color: var(--ms-muted, #7c8a96);
  font-size: clamp(14.5px, 1.5vw, 16.5px);
  line-height: 1.5;
  text-wrap: pretty;
}

.error-screen__extra {
  width: 100%;
  max-width: 520px;
}

.error-screen__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: clamp(6px, 1.6vh, 14px);
}

.error-screen__actions :deep(.q-btn) {
  min-height: 44px;
  padding: 0 20px;
}

.error-screen__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 10px;
  border-top: 1px solid var(--ms-border, #e2e6ea);
  padding-top: clamp(12px, 2vh, 18px);
  color: var(--ms-muted, #7c8a96);
  font-size: 13px;
}

.error-screen__foot a {
  color: var(--ms-accent, #2ea25e);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--ms-accent, #2ea25e) 40%, transparent);
}

.error-screen__foot a:hover {
  border-bottom-color: var(--ms-accent, #2ea25e);
}

/* На телефоне кнопки — в одну колонку: так по ним проще попасть. */
@media (max-width: 430px) {
  .error-screen__actions {
    width: 100%;
  }

  .error-screen__actions :deep(.q-btn) {
    flex: 1 1 100%;
  }
}
</style>
