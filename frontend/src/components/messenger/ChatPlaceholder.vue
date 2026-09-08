<template>
  <div class="chat-placeholder">
    <EmptyState
      icon="forum"
      title="Выберите, кому хотели бы написать"
      hint="Начните переписку: найдите собеседника по логину или телефону."
    >
      <template #action>
        <q-btn
          unelevated
          no-caps
          color="primary"
          class="ghost-btn q-mt-sm"
          @click="emit('open-contacts')"
        >
          Открыть контакты
        </q-btn>
      </template>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue'

const emit = defineEmits<{
  (e: 'open-contacts'): void
}>()
</script>

<style scoped>
.chat-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  background: transparent;
}
</style>
