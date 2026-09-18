<template>
  <!-- Всплывающее окно у самого чипа (как в Telegram): открывается снизу от
       реакции, при нехватке места Quasar сам разворачивает его вверх. -->
  <q-menu
    :model-value="true"
    :target="anchor ?? undefined"
    no-parent-event
    anchor="bottom middle"
    self="top middle"
    :offset="[0, 6]"
    class="ru-menu"
    @update:model-value="emit('close')"
  >
    <div class="ru-card">
      <div class="ru-head">
        <span class="ru-emoji" aria-hidden="true">{{ selected }}</span>
        <span class="ru-title">Кто поставил</span>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" aria-label="Закрыть" @click="emit('close')" />
      </div>
      <q-separator />

      <div class="ru-body">
        <!-- Эмодзи-вкладки: у сообщения может быть несколько реакций. -->
        <div v-if="reactions.length > 1" class="ru-tabs" role="tablist" aria-label="Реакции">
          <button
            v-for="reaction in reactions"
            :key="reaction.emoji"
            type="button"
            class="ru-tab"
            :class="{ active: reaction.emoji === selected }"
            role="tab"
            :aria-selected="reaction.emoji === selected"
            @click="selected = reaction.emoji"
          >
            <!-- В окне «кто отметил» эмодзи крупнее, чем в чипе у сообщения:
                 здесь он и есть содержание, а не значок рядом со счётчиком. -->
            <span class="ru-tab-emoji" aria-hidden="true">{{ reaction.emoji }}</span>
            <span class="ru-tab-count">{{ reaction.count }}</span>
          </button>
        </div>

        <p v-if="!userIds.length" class="ru-empty">
          Никого: реакции сняли (или приложение собеседника их не передаёт).
        </p>
        <ul v-else class="ru-list">
          <li v-for="id in userIds" :key="id" class="ru-row">
            <span class="ru-avatar">
              <img v-if="memberAvatar(id)" :src="memberAvatar(id)" alt="" loading="lazy" />
              <template v-else>{{ initials(nameOf(id)) }}</template>
            </span>
            <span class="ru-name" :class="{ mine: id === myUserId }">{{ nameOf(id) }}</span>
            <span v-if="id === myUserId" class="ru-me">вы</span>
          </li>
        </ul>
      </div>
    </div>
  </q-menu>
</template>

<script setup lang="ts">
/**
 * Кто поставил реакцию.
 *
 * Зачем: в группе счётчик «👍 3» читается как «кто-то», а смысл реакции — как раз
 * в том, кто её поставил. Тап по реакции ставит/снимает СВОЮ (привычное
 * действие), поэтому список открывается удержанием или правым кликом.
 *
 * Имена берём из участников чата — сервер отдаёт только id (`user_ids` в
 * агрегате реакции), чтобы не дублировать имена в каждом сообщении.
 */
import { computed, ref } from 'vue'

import type { ChatUser, ReactionSummary } from '@/types'
import { icon } from '@/utils/icons'
import { avatarUrlOf, displayName, initials } from '@/utils/user'

const props = defineProps<{
  /** Реакции сообщения (агрегат с `user_ids`). */
  reactions: ReactionSummary[]
  /** Участники чата: по ним находятся имена и аватары. */
  members: ChatUser[]
  myUserId: number | null
  /** С какой реакции открыли список. */
  initialEmoji: string
  /** Чип реакции, у которого открывается окно (якорь позиционирования). */
  anchor?: HTMLElement | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const selected = ref<string>(props.initialEmoji)

const current = computed<ReactionSummary | null>(
  () => props.reactions.find((item) => item.emoji === selected.value) ?? props.reactions[0] ?? null
)

/** Сначала я, потом остальные — так «моя» реакция всегда на виду. */
const userIds = computed<number[]>(() => {
  const ids = current.value?.user_ids ?? []
  const mine = props.myUserId === null ? [] : ids.filter((id) => id === props.myUserId)
  return [...mine, ...ids.filter((id) => id !== props.myUserId)]
})

const nameOf = (userId: number): string => {
  const member = props.members.find((item) => item.id === userId)
  if (!member) return 'Участник'
  return userId === props.myUserId ? 'Вы' : displayName(member)
}

/** Аватар участника (миниатюра), если она есть. */
const memberAvatar = (userId: number): string | undefined => {
  const member = props.members.find((item) => item.id === userId)
  return member ? avatarUrlOf(member) : undefined
}
</script>

<style scoped>
/* Окно — у самого чипа, поэтому оно узкое: список имён, а не карточка. */
.ru-card {
  width: min(280px, calc(100vw - 24px));
  padding: var(--ms-space-2) 0 var(--ms-space-1);
}

.ru-head {
  display: flex;
  align-items: center;
  gap: var(--ms-space-2);
  padding: 0 var(--ms-space-2) var(--ms-space-1) var(--ms-space-3);
}

/* Крупный эмодзи окна: в сообщении тот же эмодзи мелкий (там он — метка). */
.ru-emoji {
  font-size: 24px;
  line-height: 1;
}

.ru-title {
  font-size: var(--ms-fs-base);
  font-weight: 700;
  color: var(--ms-text);
}

.ru-body {
  padding: var(--ms-space-2) var(--ms-space-3) 0;
}

.ru-tabs {
  display: flex;
  gap: var(--ms-space-1);
  overflow-x: auto;
  padding-bottom: var(--ms-space-2);
  scrollbar-width: none;
}

.ru-tabs::-webkit-scrollbar {
  display: none;
}

.ru-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface-2);
  border-radius: 999px;
  padding: 3px 9px;
  font: inherit;
  cursor: pointer;
}

.ru-tab.active {
  border-color: var(--ms-accent-border);
  background: var(--ms-accent-soft);
}

.ru-tab-emoji {
  font-size: var(--ms-fs-lg);
  line-height: 1;
}

.ru-tab-count {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.ru-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(280px, 50vh);
  overflow-y: auto;
}

.ru-row {
  display: flex;
  align-items: center;
  gap: var(--ms-space-2);
  padding: 6px 2px;
}

.ru-avatar {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
}

.ru-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ru-name {
  font-size: var(--ms-fs-base);
  color: var(--ms-text);
}

.ru-name.mine {
  font-weight: 600;
}

.ru-me {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.ru-empty {
  margin: 0;
  padding-bottom: var(--ms-space-2);
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
}
</style>
