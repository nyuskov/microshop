<template>
  <!--
    Связь с сервером компактной пилюлей прямо в шапке.

    Раньше про обрыв связи сообщала отдельная полоса во всю ширину сверху
    (`OfflineBanner`): она перекрывала содержимое экрана, хотя сообщать нужно
    всего пару слов. Теперь состояние видно там, где человек и так смотрит — в
    шапке списка чатов; полоса осталась только вне мессенджера (экран входа), где
    шапки нет.

    Показываем не только обрыв: «Соединение…» — пока связь проверяется и пока
    догоняются пропущенные данные, «Связь восстановлена» — пару секунд после
    возврата. Когда всё в порядке, место занимает единственная полезная мелочь —
    тихие часы (уведомления в это время не приходят).

    Пилюля живёт в пустом месте шапки (между историями и кнопками) и только в нём:
    значки шапка не прячет и не сдвигает, поэтому длинный текст усечётся, а не
    налезет на них (см. `SidebarHeader.vue`).
  -->
  <component
    :is="interactive ? 'button' : 'span'"
    v-if="connectionText"
    class="conn-status"
    :class="tone"
    :type="interactive ? 'button' : undefined"
    :role="interactive ? undefined : 'status'"
    :aria-live="interactive ? undefined : 'polite'"
    :title="title"
    :aria-label="title"
    @click="onClick"
  >
    <q-icon :name="icon(iconName)" size="15px" aria-hidden="true" />
    <span class="conn-text">{{ connectionText }}</span>
  </component>

  <span
    v-else-if="quiet"
    class="conn-status quiet"
    :title="t('Тихие часы: уведомления не приходят')"
    aria-label="Тихие часы"
  >
    <q-icon :name="icon('dark_mode')" size="15px" aria-hidden="true" />
    <span class="conn-text">{{ t('Тихие часы') }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * Состояние связи с сервером для шапки списка чатов.
 *
 * Нужен, чтобы обрыв связи и догрузку после него было видно на экране: без этого
 * человек не понимает, почему сообщение не уходит, и думает, что сломалось
 * приложение (см. `useOnlineStatus` — состояние общее на всё приложение, от него
 * зависят и догрузка пропущенного, и сам этот значок).
 *
 * «Когда что показывать» решает общее состояние (`state` из `useOnlineStatus`):
 * то же самое показывает подпись в открытом чате, поэтому два места не могут
 * разойтись.
 */
import { useConnectionNotice } from '@/composables/useConnectionNotice'
import { icon } from '@/utils/icons'
import { t } from '@/i18n'

/**
 * «О чём говорить в середине шапки» живёт в общем композабле
 * (`useConnectionNotice`): по тому же правилу шапка решает, сколько кружков
 * историй показать рядом (см. `SidebarHeader.vue`), поэтому двух копий правила
 * быть не должно — надпись и число кружков иначе разъедутся.
 */
const { connectionText, iconName, tone, interactive, title, quiet, recheck } = useConnectionNotice()

const onClick = () => {
  if (interactive.value) void recheck()
}
</script>

<style scoped>
.conn-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  /* Отступы намеренно узкие (было 5 px 9 px): пилюля прозрачная, а её ширина
     на узком телефоне (360 px) — это ровно то, что надпись отдаёт ряду историй
     со счётчиком «+N». Экономия 4 px — и «Тихие часы» / «Quiet hours» видны
     целиком, а не «Quiet hou…» (владелец прислал такой скрин с телефона). */
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: var(--ms-radius-pill);
  font-family: inherit;
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  line-height: 1.25;
  color: var(--ms-muted-2);
  background: transparent;
  white-space: nowrap;
  overflow: hidden;
}

/* Фона у надписи НЕТ ни в одном состоянии (владелец 22.09.2026: «прозрачный фон
   у сообщения по центру»): состояние читается цветом текста и значка, а шапка не
   получает цветную плашку посреди своих иконок. */
.conn-status.offline {
  color: var(--ms-danger);
  cursor: pointer;
}

.conn-status.connecting {
  color: var(--ms-muted);
}

.conn-status.restored {
  color: var(--ms-text);
}

.conn-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Соединение: значок крутится, пока связь проверяется (как в полосе сверху). */
.conn-status.connecting .q-icon {
  animation: conn-spin 1.4s linear infinite;
}

@keyframes conn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
