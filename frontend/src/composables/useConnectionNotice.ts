/**
 * «О чём говорит середина шапки» — состояние связи и тихие часы.
 *
 * Вынесено из `components/common/ConnectionStatus.vue`, потому что то же правило
 * нужно самой шапке: надпись в середине занимает свободное место, и ряд историй
 * рядом становится короче (см. `SidebarHeader.vue` и
 * `utils/stories.headerStoriesLimit`). Двух копий правила быть не должно — иначе
 * надпись и число кружков разъедутся.
 *
 * Тексты короткие не случайно: место в шапке телефона — это пустой промежуток
 * между значками (~125 px), и длинная фраза в нём усекалась бы; полный текст
 * живёт в подсказке (`title`).
 */
import { computed, type ComputedRef } from 'vue'

import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useAuthStore } from '@/stores/auth'
import { isQuietHoursNow } from '@/utils/quietHours'
import { t } from '@/i18n'

export interface ConnectionNotice {
  /** Текст надписи ('' — показывать нечего, связь в порядке). */
  connectionText: ComputedRef<string>
  /** Вид значка: обрыв — перечёркнутая сеть, соединение — вращающаяся стрелка. */
  iconName: ComputedRef<string>
  /** Тон оформления (класс состояния: offline / connecting / restored). */
  tone: ComputedRef<string>
  /** Без связи надпись можно нажать: проверить прямо сейчас, не ожидая маяка. */
  interactive: ComputedRef<boolean>
  /** Полная подсказка (в неё уходит то, что не влезло в надпись). */
  title: ComputedRef<string>
  /** Тихие часы — когда о связи сказать нечего. */
  quiet: ComputedRef<boolean>
  /** Надпись вообще занимает место в середине шапки. */
  visible: ComputedRef<boolean>
  /** Проверить связь немедленно. */
  recheck: () => Promise<void>
}

export function useConnectionNotice(): ConnectionNotice {
  const { state, recheck } = useOnlineStatus()
  const authStore = useAuthStore()

  const connectionText = computed(() => {
    if (state.value === 'offline') return t('Нет сети')
    if (state.value === 'connecting') return t('Соединение…')
    if (state.value === 'restored') return t('Связь есть')
    return ''
  })

  const iconName = computed(() => {
    if (state.value === 'offline') return 'wifi_off'
    if (state.value === 'connecting') return 'refresh'
    return 'wifi'
  })

  const tone = computed(() => state.value)

  const interactive = computed(() => state.value === 'offline')

  const title = computed(() => {
    if (state.value === 'offline') {
      return t('Нет подключения к интернету. Нажмите, чтобы проверить связь')
    }
    if (state.value === 'connecting') return t('Соединение…')
    return t('Связь восстановлена')
  })

  /**
   * Тихие часы — когда связь в порядке и сказать больше нечего.
   *
   * Считается от настроек профиля на момент отрисовки: окно тишины длинное
   * (часы), а значок — подсказка, а не будильник, поэтому отдельного таймера ему
   * не нужно.
   */
  const quiet = computed(() => isQuietHoursNow(authStore.current_user?.profile))

  return {
    connectionText,
    iconName,
    tone,
    interactive,
    title,
    quiet,
    visible: computed(() => connectionText.value !== '' || quiet.value),
    recheck
  }
}
