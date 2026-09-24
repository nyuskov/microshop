<template>
  <!--
    Свёрнутый звонок: плашка, которая ложится ПОВЕРХ шапки чата (как в MAX).

    Разговор при этом идёт, а чат остаётся рабочим — можно читать и писать, не
    выходя из звонка. Показывается из `Messenger.vue`: над шапкой чата (внутри
    панели чата) и, на телефоне, над списком чатов. Поэтому позиционирование
    задаёт родитель: сам компонент — обычная строка высотой с шапку.
  -->
  <div class="call-banner">
    <!--
      «Волна» звонка: живая линия, которая бежит вдоль ВСЕЙ шапки (как в MAX).
      Просьба владельца: «непонятно, только галка» — статичная плашка с одной
      стрелкой не говорила, что разговор ещё идёт.

      Устройство: путь — ОДНА непрерывная линия из 16 полуволн (4 периода), а
      сдвиг идёт ровно на половину ширины контейнера: это целое число периодов,
      поэтому цикл бесшовный и стыка-шва (двух отдельных копий) нет вовсе.
      По той же причине при «уменьшить движение» (a11y.css гасит анимации
      глобально, `animation-iteration-count: 1`) кадр остаётся целой волной, а
      не «застывшей на середине». Декоративная: скринридеру говорить нечего.
    -->
    <span
      v-for="layer in 2"
      :key="layer"
      class="cb-wave"
      :class="`cb-wave--${layer}`"
      aria-hidden="true"
    >
      <svg class="cb-wave-svg" viewBox="0 0 480 14" preserveAspectRatio="none">
        <path
          d="M0 7 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </span>

    <!-- На телефоне плашка закрывает кнопку «назад» шапки чата — оставляем её тут,
         иначе из чата в список было бы не выйти, пока звонок свёрнут. -->
    <button
      v-if="showBack"
      class="cb-btn cb-back"
      :title="t('К списку чатов')"
      :aria-label="t('К списку чатов')"
      @click="emit('back')"
    >
      <q-icon :name="icon('arrow_back')" size="20px" />
    </button>

    <!-- Имя и таймер — кнопка «вернуться»: тап по ним разворачивает звонок
         обратно на весь экран. Отдельной стрелки «развернуть» тут нет: человек
         и так жмёт по плашке (решение владельца 24.09.2026). -->
    <button class="cb-info" :title="t('Вернуться в звонок')" @click="callStore.restoreCall()">
      <span
        v-if="callStore.isGroup"
        class="cb-avatar cb-avatar-group"
        :class="{ speaking: peerSpeaking }"
      >
        <q-icon :name="icon('group')" size="18px" />
      </span>
      <span v-else class="cb-avatar" :class="{ speaking: peerSpeaking }" :style="avatarStyle(name)">
        <img
          v-if="avatarUrl && !avatarImgFailed"
          :src="avatarUrl"
          class="cb-avatar-img"
          alt=""
          @error="avatarImgFailed = true"
        />
        <template v-else>{{ initials(name) }}</template>
      </span>
      <span class="cb-text">
        <span class="cb-name">{{ name }}</span>
        <span class="cb-sub">{{ subtitle }}</span>
      </span>
    </button>

    <span class="cb-actions">
      <button
        class="cb-btn"
        :class="{ off: !callStore.micOn }"
        :title="t('Микрофон')"
        :aria-label="t('Микрофон')"
        @click="callStore.toggleMic()"
      >
        <q-icon :name="icon(callStore.micOn ? 'mic' : 'mic_off')" size="19px" />
      </button>
      <!-- Камера — только в видеозвонке: в голосовом её нет, и кнопка обещала бы
           то, чего не случится. Показ экрана переключается кнопкой камеры
           (см. `toggleCamera`) — отдельную кнопку в плашке не поместить. -->
      <button
        v-if="callStore.kind === 'video'"
        class="cb-btn"
        :class="{ off: !callStore.videoOn }"
        :title="t('Камера')"
        :aria-label="t('Камера')"
        @click="callStore.toggleCamera()"
      >
        <q-icon :name="icon(callStore.videoOn ? 'videocam' : 'videocam_off')" size="19px" />
      </button>
      <button
        class="cb-btn cb-end"
        :title="callStore.status === 'outgoing' ? t('Отменить') : t('Завершить')"
        :aria-label="callStore.status === 'outgoing' ? t('Отменить') : t('Завершить')"
        @click="hangUp"
      >
        <q-icon :name="icon('call_end')" size="20px" />
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import { mediaUrl } from '@/services/chatService'
import { useCallStore } from '@/stores/call'
import { avatarStyle as userAvatarStyle, initials as userInitials } from '@/utils/user'

defineProps<{
  /** Показывать ли кнопку «назад» (нужна на телефоне: плашка закрывает шапку). */
  showBack?: boolean
}>()

const emit = defineEmits<{ back: [] }>()

const callStore = useCallStore()

/**
 * Говорит ли собеседник (в группе — кто-нибудь из участников).
 *
 * Уровнем речи это уже считается в сторе (см. `_updateSpeaking`): в плашке он
 * превращается в кольцо вокруг аватара — видно, что разговор живой, не
 * разворачивая звонок.
 */
const peerSpeaking = computed<boolean>(() =>
  callStore.isGroup
    ? callStore.participants.some((participant) => participant.speaking)
    : callStore.peerSpeaking
)

/** Имя собеседника (в группе — без списка участников: он не помещается). */
const name = computed<string>(() => {
  if (callStore.isGroup) return t('Групповой звонок')
  const raw = callStore.peerName.trim()
  return raw || t('Пользователь {id}', { id: callStore.peerId ?? '' }).trim()
})

/** Вторая строка: идёт вызов или сколько уже разговариваем. */
const subtitle = computed<string>(() =>
  callStore.status === 'outgoing' ? t('Звоним…') : callStore.formattedTime
)

const avatarUrl = computed<string | undefined>(() => {
  const path = callStore.peerAvatar
  return path ? mediaUrl(path) : undefined
})

const avatarStyle = (value: string): Record<string, string> => userAvatarStyle(value)
const initials = (value: string): string => userInitials(value)

// Если аватар не загрузился — показываем инициалы, а не «битую» картинку
// (та же подмена, что в полном экране звонка).
const avatarImgFailed = ref(false)
watch(avatarUrl, () => {
  avatarImgFailed.value = false
})

/**
 * Кнопка сброса: у идущего вызова — «Завершить», у своего вызова — «Отменить».
 * В группе «Отменить» гасит вызов у всех участников (`cancelCall`), а
 * `endCall` завершил бы разговор.
 */
const hangUp = (): void => {
  if (callStore.status === 'outgoing') callStore.cancelCall()
  else callStore.endCall()
}
</script>

<style scoped>
/*
 * Высота — РОВНО как у шапки чата: плашка её перекрывает, и щель по краю
 * выглядела бы как сломанная рамка.
 *
 * Значения — по живым замерам: на телефоне шапка 58px (аватар 40 + отступы 8+8
 * + линия 1), на широком экране 61px (там крупнее подписи в шапке), совсем
 * узкий экран — 49px (аватар 36 и отступы 6+6).
 */
.call-banner {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 58px;
  padding: 8px 10px 8px 8px;
  background: var(--ms-surface);
  border-bottom: 1px solid var(--ms-border);
  box-shadow: var(--ms-shadow-sm);
  color: var(--ms-text);
  font-family: var(--ms-font);
  /* Волна шире плашки (две копии в ряд) — по краям обрезаем, иначе уезжала бы
     на соседние элементы. */
  overflow: hidden;
}

/* Содержимое — выше волны: она рисуется поверх фона, но не поверх текста и
   кнопок (`position: absolute` рисуется после статичных элементов). */
.call-banner > *:not(.cb-wave) {
  position: relative;
  z-index: 1;
}

/*
 * «Волна» звонка. Две волны-линии с разной скоростью: передняя — по нижней
 * кромке (там, где у шапки линия), задняя — выше и бледнее, чтобы движение
 * читалось как волна, а не как бегущая полоса.
 */
.cb-wave {
  position: absolute;
  left: 0;
  bottom: 0;
  display: flex;
  width: 200%;
  height: 14px;
  color: var(--ms-accent);
  opacity: 0.45;
  pointer-events: none;
  animation: cb-wave-run 5s linear infinite;
}

.cb-wave--2 {
  bottom: 5px;
  height: 10px;
  opacity: 0.22;
  animation-duration: 8s;
}

.cb-wave-svg {
  width: 100%;
  height: 100%;
}

/* Сдвиг = ровно половина ширины контейнера, а это целое число периодов волны
   (4 периода): стыка нет вовсе, поэтому кадр в любой момент целый. */
@keyframes cb-wave-run {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (min-width: 600px) {
  .call-banner {
    min-height: 63px;
  }
}

.cb-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  /* Вертикальные отступы минимальные: с ними блок имени (тридцать с небольшим
     пикселей) перерастал аватар 34px, и плашка становилась выше шапки. */
  padding: 2px;
  border: none;
  border-radius: var(--ms-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* Наведение фоном НЕ подсвечиваем (решение владельца 24.09.2026: «стремно
   получается» — плашка и так одна на всём экране, подсказка есть в title). */

.cb-avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  color: var(--ms-on-accent);
  background: var(--ms-surface-2);
  font-size: 0.85rem;
  font-weight: 600;
}

/* Групповой звонок: вместо аватара одного человека — значок группы. */
.cb-avatar-group {
  color: var(--ms-accent);
  background: var(--ms-accent-soft);
}

.cb-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Собеседник говорит: вокруг аватара расходится кольцо акцента. В свёрнутом
   звонке это единственный признак живой речи (плиток участников не видно). */
.cb-avatar.speaking {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ms-accent) 32%, transparent);
  animation: cb-speaking 0.9s ease-in-out infinite alternate;
}

@keyframes cb-speaking {
  from {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ms-accent) 32%, transparent);
  }
  to {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--ms-accent) 10%, transparent);
  }
}

.cb-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cb-name {
  font-size: var(--ms-fs-md);
  font-weight: 600;
  /* Своя плотная строка: от неё зависит высота всей плашки (см. `.cb-info`). */
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Таймер — цифрами при равной ширине: иначе он «дрожит» каждую секунду. */
.cb-sub {
  font-size: var(--ms-fs-xs);
  line-height: 1.2;
  color: var(--ms-muted);
  font-variant-numeric: tabular-nums;
}

.cb-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.cb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--ms-text);
  cursor: pointer;
  transition: background 0.12s;
}

.cb-btn:hover {
  background: var(--ms-hover);
}

/* Выключенный микрофон (или камера): тем же цветом, что и опасные действия, —
   человек видит, что его не слышат/не видят, не разворачивая звонок. */
.cb-btn.off {
  color: var(--ms-danger);
}

.cb-end {
  color: var(--ms-danger);
}

.cb-end:hover {
  background: var(--ms-danger-bg);
}

@media (max-width: 480px) {
  /* На телефоне кнопок столько же, но экран уже — отдаём место имени. */
  .call-banner {
    padding: 8px 6px;
    gap: 0;
  }

  .cb-btn {
    width: 36px;
  }
}

@media (max-width: 380px) {
  /* Шапка чата тут ниже: 36 (аватар) + 6+6 (отступы) + 1 (линия). */
  .call-banner {
    min-height: 49px;
    padding: 6px 6px;
  }
}
</style>
