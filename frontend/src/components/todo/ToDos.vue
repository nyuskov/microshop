<script setup>
import HeaderMain from "./headers/HeaderMain.vue"
import ToDoProject from "./ToDoProject.vue";
</script>

<template>
    <div class="app">
        <HeaderMain></HeaderMain>
        <main class="w3-container">
            <ToDoProject></ToDoProject>
        </main>
    </div>
</template>

<style scoped>
.app {
    width: 100vw;
    min-height: 100vh;
    padding: 0;
}
</style>