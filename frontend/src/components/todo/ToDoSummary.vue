<script setup lang="ts">
import { ref, computed } from "vue";
import todoService from "@/services/todo";

const $props = defineProps({
    items: { type: Array, default: () => [] }
});
interface ToDoItem {
    status: string;
}

const _status = computed(() => {
    let status: Record<string, number> = {};
    todoService.getStatusList().forEach(stat => {
        status[stat.id] = 0;
    });
    const $props = defineProps({
        items: {
            type: Array as () => ToDoItem[],
            default: () => []
        }
    });
    return status;
});
</script>

<template>
    <div class="summary-wrapper">
        <div class="w3-light-gray">
            <strong>Pending</strong>
            <h2>{{ _status?.not_started }}</h2>
        </div>
        <div class="w3-teal">
            <strong>In progress</strong>
            <h2>{{ _status?.in_progress }}</h2>
        </div>
        <div class="w3-green">
            <strong>Completed</strong>
            <h2>{{ _status?.completed }}</h2>
        </div>
    </div>
</template>

<style scoped>
.summary-wrapper {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
}

.summary-wrapper div {
    padding: 1rem;
}

h2 {
    font-size: 3rem;
    margin: 0;
}
</style>