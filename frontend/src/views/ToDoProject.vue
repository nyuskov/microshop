<script setup lang="ts">
import { ref, inject, onMounted, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import ToDoItemForm from "@/components/todo/ToDoItemForm.vue";
import TodoList from "@/components/todo/ToDoList.vue";
import TodoFilter from "@/components/todo/ToDoFilter.vue";
import TodoSummary from "@/components/todo/ToDoSummary.vue";
import todoService from "@/services/todo";
import eventBus from "@/services/eventBus";
import Sidebar from "@/components/sidebar/Sidebar.vue";

interface ToDoItem {
    id: string;
    text: string;
    status: string;
}

const
    $props = defineProps(["id"]),
    $modals = inject<{ show: (name: string) => Promise<void> }>("$modals")!,
    $router = useRouter(),
    _filter = ref(""),
    _item = ref(todoService.getDefault()),
    _items: Ref<ToDoItem[], ToDoItem[]> = ref<ToDoItem[]>([]),
    _project_name = ref("");

// First time mounted
onMounted(loadProject);

// Watch for future changes
watch(() => $props.id, loadProject);


// Shows a modal to create or edit a to-do item
function showModal(new_item = true, item: Partial<ToDoItem> = {}) {
    if (new_item) {
        _item.value = todoService.getDefault();
    } else {
        // Ensure id is treated as string
        const safeItem = {
            ...item,
            id: String(item.id) // Convert id to string
        };
        _item.value = todoService.makeCopy(safeItem as ToDoItem);
    }

    $modals.show("newEditItem").then(() => {
        if (new_item) {
            _items.value.push(_item.value);
        } else {
            let index = getIndex(_item.value);
            if (index >= 0) {
                _items.value[index] = _item.value;
            } else {
                alert("Error updating the item");
            }
        }
        saveProject();
    }, () => { });
}

function deleteItem(item: Partial<ToDoItem>) {
    $modals.show("deleteItem").then(() => {
        let index = getIndex(item);
        if (index >= 0) {
            _items.value.splice(index, 1);
            saveProject();
        }
    }, () => { })
}

// Auxiliar function 
function getIndex(item: Partial<ToDoItem>) {
    return _items.value.findIndex(it => it.id === String(item.id));
}
function toggleStatus(item: Partial<ToDoItem>) {
    item.status = todoService.toggleStatus(item.status);
    saveProject();
}

// Deletes the entire project and triggers a system-wide update event
function deleteProject() {
    $modals.show("deleteProject").then(() => {
        // delete project
        todoService.deleteProject($props.id);
        eventBus.emit("#UpdateProjects");
        $router.push({ name: "landing" })
    }, () => { })
}

// Chapter 5
function loadProject() {
    // Project name
    _project_name.value = todoService.getProjectName($props.id);

    // Items
    _items.value = todoService.loadProject($props.id);
}

function saveProject() {
    todoService.saveProject($props.id, _items.value);
}
</script>

<template>
    <div class="app">
        <Sidebar></Sidebar>
        <main>
            <div class="project-container">

                <!-- Project name -->
                <div class="header-container">
                    <h1>{{ _project_name }}</h1>
                    <button @click="deleteProject()">Delete project</button>
                </div>


                <!-- Summary -->
                <TodoSummary :items="_items" class="w3-margin-bottom"></TodoSummary>

                <!-- Filter bar -->
                <div class="w3-margin-bottom">
                    <TodoFilter v-model="_filter" class="flex-grow"></TodoFilter>
                </div>

                <!-- Todo list -->
                <TodoList v-model="_items" :filter="_filter" @toggle="toggleStatus"
                    @edit="(item) => showModal(false, { ...item, id: String(item.id) })" @delete="deleteItem">
                    <button @click="showModal(true)" class="w3-button w3-blue w3-round-xxlarge">
                        <i class="fa-solid fa-square-plus"></i>
                        New item
                    </button>
                </TodoList>

                <!-- Modals -->
                <Modal name="newEditItem" title="To Do Item">
                    <ToDoItemForm v-model="_item"></ToDoItemForm>
                </Modal>

                <Modal name="deleteItem" title="Delete To-Do Item">
                    <p>
                        This action will delete the item:<br>
                        <strong>{{ _item.text }}</strong>
                    </p>
                    <p class="w3-text-red w3-pale-red">
                        This action cannot be undone.
                    </p>
                </Modal>

                <Modal name="deleteProject" title="Delete the Project">
                    <h3>Attention</h3>
                    <p class="w3-pale-red w3-text-red w3-padding">This action cannot be undone. Please confirm.</p>
                </Modal>
            </div>
        </main>
    </div>
</template>

<style scoped>
.header-container {
    display: flex;
    justify-content: space-between;
    align-content: center;
    align-items: center;
}

.project-container {
    max-width: 56rem;
    padding: 1rem;
    margin: 0 auto;
}

.app {
    width: 100vw;
    height: 100vh;
    padding: 0;
    overflow: hidden;
    display: grid;
    grid-template-columns: 12rem auto;
}

main {
    overflow: hidden auto;
}
</style>