<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="bk-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="bk-title">{{ t('Ключ шифрования') }}</div>
        <q-space />
        <q-btn
          flat
          round
          dense
          :icon="icon('close')"
          :aria-label="t('Закрыть')"
          @click="emit('close')"
        />
      </q-card-section>
      <q-separator />

      <q-card-section class="bk-body">
        <p class="bk-text">
          {{
            t(
              'Ключ сквозного шифрования живёт только в этом браузере: переустановка приложения, очистка данных или потеря телефона делают переписку в зашифрованных чатах нечитаемой — сервер расшифровать её не может. Копия ключа, зашифрованная вашей парольной фразой, возвращает доступ на новом устройстве.'
            )
          }}
        </p>
        <p class="bk-warn">
          {{
            t(
              'Файл копии и парольная фраза вместе — это доступ ко всей переписке. Храните их отдельно друг от друга (фразу удобно держать в менеджере паролей) и никому не пересылайте: поддержка такую копию никогда не попросит.'
            )
          }}
        </p>

        <div class="bk-modes" role="tablist" :aria-label="t('Действие с копией')">
          <button
            type="button"
            class="bk-mode"
            :class="{ active: mode === 'export' }"
            role="tab"
            :aria-selected="mode === 'export'"
            @click="setMode('export')"
          >
            {{ t('Сохранить копию') }}
          </button>
          <button
            type="button"
            class="bk-mode"
            :class="{ active: mode === 'import' }"
            role="tab"
            :aria-selected="mode === 'import'"
            @click="setMode('import')"
          >
            {{ t('Восстановить') }}
          </button>
        </div>

        <template v-if="mode === 'export'">
          <label class="bk-label" for="bk-pass">{{ t('Парольная фраза') }}</label>
          <input
            id="bk-pass"
            v-model="passphrase"
            class="bk-input"
            type="password"
            autocomplete="new-password"
            :placeholder="t('Не короче {count} символов', { count: MIN_PASSPHRASE_LENGTH })"
          />
          <label class="bk-label" for="bk-pass-repeat">{{ t('Повторите фразу') }}</label>
          <input
            id="bk-pass-repeat"
            v-model="repeat"
            class="bk-input"
            type="password"
            autocomplete="new-password"
          />
          <p class="bk-hint">
            {{ t('Фразу не восстановить: если забудете — копия останется запертой.') }}
          </p>
          <button type="button" class="bk-btn" :disabled="!canExport || busy" @click="saveBackup">
            <q-icon :name="icon('download')" size="17px" />
            {{ busy ? t('Готовим файл…') : t('Сохранить файл копии') }}
          </button>
        </template>

        <template v-else>
          <label class="bk-label" for="bk-file">{{ t('Файл копии') }}</label>
          <input
            id="bk-file"
            ref="fileInput"
            class="bk-file"
            type="file"
            accept=".json,application/json"
            @change="onFileSelected"
          />
          <button type="button" class="bk-btn ghost" @click="fileInput?.click()">
            <q-icon :name="icon('attach_file')" size="17px" />
            {{ file ? file.name : t('Выбрать файл') }}
          </button>
          <label class="bk-label" for="bk-pass-restore">{{ t('Парольная фраза') }}</label>
          <input
            id="bk-pass-restore"
            v-model="passphrase"
            class="bk-input"
            type="password"
            autocomplete="current-password"
          />
          <p class="bk-warn">
            {{
              t(
                'Ключ этого браузера будет заменён ключом из копии, а приложение — перезапущено, чтобы перечитать переписку.'
              )
            }}
          </p>
          <button type="button" class="bk-btn" :disabled="!canRestore || busy" @click="restore">
            <q-icon :name="icon('cloud_upload')" size="17px" />
            {{ busy ? t('Восстанавливаем…') : t('Восстановить ключ') }}
          </button>
        </template>

        <p v-if="error" class="bk-error" role="alert">{{ error }}</p>
        <transition name="fade">
          <p v-if="done" class="bk-done">{{ done }}</p>
        </transition>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Резервная копия ключа шифрования: сохранить и восстановить.
 *
 * Зачем: приватный ключ устройства живёт только в `localStorage`, и потеря
 * устройства уносит с собой всю переписку зашифрованных чатов (мультиустройство
 * A5 спасает второе АКТИВНОЕ устройство, но не пропажу телефона). Копия — файл
 * с ключом, зашифрованный парольной фразой (`services/e2eeBackup.ts`).
 *
 * Ничего не делается автоматически: только по явному действию человека, с
 * предупреждением о том, что файл + фраза = доступ к переписке.
 */
import { computed, ref } from 'vue'

import {
  MIN_PASSPHRASE_LENGTH,
  backupFileName,
  createBackup,
  restoreBackup
} from '@/services/e2eeBackup'
import { icon } from '@/utils/icons'
import { t } from '@/i18n'

const props = defineProps<{
  /** Владелец ключа: копию нельзя восстановить в другой аккаунт. */
  myUserId: number | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

type Mode = 'export' | 'import'

const mode = ref<Mode>('export')
const passphrase = ref('')
const repeat = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
const done = ref('')

const canExport = computed(
  () => passphrase.value.trim().length >= MIN_PASSPHRASE_LENGTH && passphrase.value === repeat.value
)
const canRestore = computed(
  () => !!file.value && passphrase.value.trim().length >= MIN_PASSPHRASE_LENGTH
)

/** Смена действия: прежние ошибки и подсказки к другому действию не относятся. */
const setMode = (next: Mode): void => {
  mode.value = next
  error.value = ''
  done.value = ''
  passphrase.value = ''
  repeat.value = ''
}

const onFileSelected = (event: Event): void => {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  error.value = ''
  done.value = ''
}

/** Сохраняет текст как файл: без сервера — копия не должна никуда уезжать. */
const download = (text: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const saveBackup = async (): Promise<void> => {
  const userId = props.myUserId
  if (userId === null) return
  busy.value = true
  error.value = ''
  done.value = ''
  try {
    const text = await createBackup(userId, passphrase.value)
    download(text, backupFileName(userId))
    done.value = t('Файл копии сохранён. Держите его отдельно от парольной фразы.')
    passphrase.value = ''
    repeat.value = ''
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('Не удалось сохранить копию')
  } finally {
    busy.value = false
  }
}

const restore = async (): Promise<void> => {
  const userId = props.myUserId
  const chosen = file.value
  if (userId === null || !chosen) return
  busy.value = true
  error.value = ''
  done.value = ''
  try {
    const text = await chosen.text()
    const { deviceId } = await restoreBackup(userId, text, passphrase.value)
    done.value = t('Ключ восстановлен (устройство {device}…). Перечитываем переписку…', {
      device: deviceId.slice(0, 8)
    })
    // Столько кэшей (расшифрованные сообщения, ключи чатов) держать в памяти
    // после подмены ключа нельзя — проще и надёжнее начать сессию заново.
    globalThis.setTimeout(() => {
      try {
        window.location.reload()
      } catch {
        /* перезагрузка недоступна (например, во встроенном просмотре) */
      }
    }, 1200)
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('Не удалось восстановить ключ')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.bk-card {
  width: min(520px, calc(100vw - 24px));
  border-radius: var(--ms-radius-lg, 18px);
}

.bk-title {
  font-size: var(--ms-fs-lg);
  font-weight: 700;
  color: var(--ms-text);
}

.bk-body {
  padding: var(--ms-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ms-space-2);
}

.bk-text {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.45;
  color: var(--ms-text);
}

.bk-warn {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.45;
  color: var(--ms-warn);
  background: var(--ms-warn-bg);
  border-radius: var(--ms-radius-sm, 8px);
  padding: var(--ms-space-2);
}

.bk-modes {
  display: flex;
  gap: var(--ms-space-1);
  background: var(--ms-surface-2);
  border-radius: var(--ms-radius-sm, 8px);
  padding: 3px;
}

.bk-mode {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 7px 8px;
  font: inherit;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-muted-2);
  cursor: pointer;
}

.bk-mode.active {
  background: var(--ms-surface);
  color: var(--ms-accent);
}

.bk-label {
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  color: var(--ms-muted-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bk-input {
  width: 100%;
  font: inherit;
  font-size: var(--ms-fs-base);
  color: var(--ms-text);
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm, 8px);
  padding: 9px 11px;
}

.bk-input:focus {
  outline: none;
  border-color: var(--ms-accent);
}

/* Родное поле выбора файла не показываем: выглядит чужеродно и не в теме. */
.bk-file {
  display: none;
}

.bk-hint {
  margin: 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted);
}

.bk-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: var(--ms-radius-sm, 8px);
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font: inherit;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  padding: 10px 12px;
  cursor: pointer;
}

.bk-btn.ghost {
  background: var(--ms-surface-2);
  color: var(--ms-text);
  border: 1px solid var(--ms-border);
}

.bk-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.bk-error {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-danger);
}

.bk-done {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-accent);
}
</style>
