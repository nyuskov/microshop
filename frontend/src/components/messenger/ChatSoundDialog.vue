<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="sound-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="sound-title">Звук уведомлений</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Закрыть" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="sound-body">
        <p class="sound-hint">
          Как звучит новое сообщение
          <template v-if="chatTitle">в чате «{{ chatTitle }}»</template>. Настройка действует только
          на этом устройстве; при выключенном «Звуке сообщений» в профиле здесь всё равно будет
          тихо.
        </p>

        <ul class="sound-list" role="radiogroup" aria-label="Звук уведомлений">
          <li v-for="preset in presets" :key="preset.key">
            <button
              class="sound-row"
              :class="{ active: current === preset.key }"
              type="button"
              role="radio"
              :aria-checked="current === preset.key"
              @click="pick(preset.key)"
            >
              <q-icon
                :name="icon(preset.key === 'none' ? 'notifications_off' : 'volume_up')"
                size="18px"
                aria-hidden="true"
              />
              <span class="sound-name">{{ preset.label }}</span>
              <q-icon v-if="current === preset.key" :name="icon('check')" size="18px" />
            </button>
          </li>
          <li>
            <button
              class="sound-row"
              :class="{ active: current === null }"
              type="button"
              role="radio"
              :aria-checked="current === null"
              @click="pick(null)"
            >
              <q-icon :name="icon('undo')" size="18px" aria-hidden="true" />
              <span class="sound-name">Как в остальных чатах</span>
              <q-icon v-if="current === null" :name="icon('check')" size="18px" />
            </button>
          </li>
        </ul>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { icon } from '@/utils/icons'
import {
  chatSoundKey,
  MESSAGE_SOUNDS,
  playIncomingMessageSound,
  setChatSoundKey,
  type MessageSoundKey
} from '@/utils/sounds'

/**
 * Выбор звука уведомлений для одного чата.
 *
 * Настройка локальная (устройства): на телефоне и на компьютере она может быть
 * разной, а серверу это знание не нужно. Список звуков общий с профилем —
 * `utils/sounds.ts`, — чтобы «прослушать» звучало ровно так же, как сыграет в деле.
 */
const props = defineProps<{
  chatId: number | null
  /** Заголовок чата — чтобы в диалоге было понятно, о ком речь. */
  chatTitle: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const presets = MESSAGE_SOUNDS
const current = ref<MessageSoundKey | null>(null)

watch(
  () => props.chatId,
  (chatId) => {
    current.value = chatId === null ? null : chatSoundKey(chatId)
  },
  { immediate: true }
)

/**
 * Клик по варианту: сразу сохраняем и проигрываем — «прослушать» отдельной
 * кнопкой не нужно, звук и есть подтверждение выбора.
 */
const pick = (key: MessageSoundKey | null) => {
  current.value = key
  if (props.chatId !== null) setChatSoundKey(props.chatId, key)
  // «Как в остальных чатах» прослушиваем звуком по умолчанию, «Без звука» — тишиной.
  playIncomingMessageSound(key ?? 'default')
}
</script>

<style scoped>
.sound-card {
  width: min(420px, 94vw);
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.sound-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

.sound-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sound-hint {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.45;
  color: var(--ms-muted-2);
}

.sound-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sound-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-surface);
  color: var(--ms-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sound-row:hover {
  background: var(--ms-hover);
}

.sound-row.active {
  border-color: var(--ms-accent-border);
  background: var(--ms-accent-soft);
}

.sound-name {
  flex: 1;
}
</style>
