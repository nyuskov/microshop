<template>
  <div class="chat-placeholder">
    <i class="pi pi-comments placeholder-icon"></i>
    <h3>Выберите, кому хотели бы написать</h3>
    <p>Начните переписку: найдите собеседника по логину или телефону.</p>
    <button class="ghost-btn" @click="emit('open-contacts')">Открыть контакты</button>
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
  font-size: 4rem;
  color: #b9c6cf;
  margin-bottom: 14px;
}

.chat-placeholder h3 {
  margin: 0 0 6px;
  color: #52626f;
}

.ghost-btn {
  margin-top: 14px;
  border: 1px solid #b9c6cf;
  background: #fff;
  color: #3f7c56;
  padding: 9px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.ghost-btn:hover {
  background: #eef6ef;
}
</style>
