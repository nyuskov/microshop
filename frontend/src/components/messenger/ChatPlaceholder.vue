<template>
  <div class="chat-placeholder">
    <q-icon name="forum" class="placeholder-icon" size="64px" />
    <h3>Выберите, кому хотели бы написать</h3>
    <p>Начните переписку: найдите собеседника по логину или телефону.</p>
    <q-btn
      unelevated
      no-caps
      color="primary"
      class="ghost-btn q-mt-sm"
      @click="emit('open-contacts')"
    >
      Открыть контакты
    </q-btn>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (e: 'open-contacts'): void
}>()
</script>

<style scoped>
.chat-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #7c8a96;
  padding: 24px;
  background: transparent;
}

.placeholder-icon {
  color: #b9c6cf;
  margin-bottom: 14px;
}

.chat-placeholder h3 {
  margin: 0 0 6px;
  color: #52626f;
}

.ghost-btn {
  margin-top: 6px;
}
</style>
