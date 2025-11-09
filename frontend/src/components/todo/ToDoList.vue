<script setup lang="ts">
import { computed } from "vue";

// Define a type for the todo items
interface ToDoItem {
    id: string;
    text: string;
    status: string;
}

const $props = defineProps<{
    modelValue: ToDoItem[];
    filter: string;
}>();

const $emit = defineEmits<{
    (e: 'edit', item: ToDoItem): void;
    (e: 'delete', item: ToDoItem): void;
    (e: 'toggle', item: ToDoItem): void;
}>();

const _filtered_list = computed(() => {
    if ($props.filter) {
        return $props.modelValue.filter(item => {
            return item.text.toUpperCase().includes($props.filter.toUpperCase());
        });
    } else {
        return $props.modelValue;
    }
});
</script>

<template>
    <div>
        <table class="w3-table">
            <thead>
                <tr class="w3-bottombar w3-topbar">
                    <th>Status</th>
                    <th>Item</th>
                    <th class="w3-right-align">
                        <slot></slot>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="item in _filtered_list" :key="item.id">
                    <td class="clickable w3-hover-pale-blue" @click="$emit('toggle', item)">
                        <i class="fa-solid fa-2x fa-square w3-text-light-gray" v-if="item.status == 'not_started'"></i>
                        <i class="fa-solid fa-2x fa-square-minus w3-text-teal" v-if="item.status == 'in_progress'"></i>
                        <i class="fa-solid fa-2x fa-square-check w3-text-green" v-if="item.status == 'completed'"></i>
                    </td>
                    <td>{{ item.text }}</td>
                    <td class="w3-right-align">
                        <span
                            class="clickable w3-transparent w3-text-indigo w3-hover-text-blue w3-hover-white w3-margin-right"
                            @click="$emit('edit', item)">
                            <i class="fa-solid fa-pen-to-square"></i>
                            Edit
                        </span>

                        <span class="clickable w3-transparent w3-text-purple w3-hover-text-red w3-hover-white"
                            @click="$emit('delete', item)">
                            <i class="fa-solid fa-trash-can"></i>
                            Delete
                        </span>
                    </td>
                </tr>
                <tr v-if="_filtered_list.length == 0">
                    <td><i class="fa-solid fa-square w3-text-light-gray"></i></td>
                    <td>The list is empty.</td>
                    <td></td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
td:first-child {
    width: 5rem;
}
</style>