<template>
  <div class="posts-container">
    <h2>Все Посты</h2>
    <!-- Форма для создания нового поста -->
    <form @submit.prevent="createPost" class="post-form">
      <input
        v-model="newPostTitle"
        type="text"
        placeholder="Заголовок поста"
        required
        class="form-control-alt"
      />
      <textarea
        v-model="newPostBody"
        placeholder="Текст поста"
        required
        class="form-control-alt"
      ></textarea>
      <button type="submit" class="btn-primary">Опубликовать</button> <!-- Reverted to btn-primary (orange) -->
    </form>

    <!-- Список постов -->
    <div v-if="posts.length > 0" class="posts-list">
      <div v-for="post in posts" :key="post.id" class="post-card">
        <h3>{{ post.title }}</h3>
        <p>{{ post.body }}</p>
        <div class="post-meta">
          <small>Автор: {{ post.user_id }} | ID: {{ post.id }}</small>
        </div>
        <!-- Кнопка удаления доступна только владельцу поста -->
        <button v-if="isOwner(post.user_id)" @click="deletePost(post.id)" class="btn-danger btn-sm">Удалить</button>
      </div>
    </div>
    <p v-else>Пока нет постов.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { backendServer, useAuthStore } from '../stores/auth'; // Импортируем store и адрес бэкенда

const authStore = useAuthStore();
const userId = computed(() => authStore.current_user?.id); // Получаем ID текущего пользователя

const posts = ref<any[]>([]);
const newPostTitle = ref('');
const newPostBody = ref('');

// Helper function to check if the current user is the owner of a post
const isOwner = (postUserId: number) => {
  return userId.value === postUserId;
};

// Загрузка всех постов при монтировании
onMounted(() => {
  fetchAllPosts();
});

const fetchAllPosts = async () => {
  try {
    // Changed the API call to fetch all posts
    const response = await fetch(`${backendServer}/api/v1/posts/`);
    if (response.ok) {
      posts.value = await response.json();
    } else {
      console.error('Ошибка при загрузке постов:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка сети при загрузке постов:', error);
  }
};

const createPost = async () => {
  if (!newPostTitle.value.trim() || !newPostBody.value.trim()) return;

  try {
    const response = await fetch(`${backendServer}/api/v1/posts/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.accessToken}`, // Добавляем токен авторизации
      },
      body: JSON.stringify({
        title: newPostTitle.value,
        body: newPostBody.value,
      }),
    });

    if (response.ok) {
      const createdPost = await response.json();
      posts.value.unshift(createdPost); // Добавляем новый пост в начало списка
      newPostTitle.value = '';
      newPostBody.value = '';
    } else {
      console.error('Ошибка при создании поста:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка сети при создании поста:', error);
  }
};

const deletePost = async (postId: number) => {
  if (!confirm('Вы уверены, что хотите удалить этот пост?')) return;

  try {
    const response = await fetch(`${backendServer}/api/v1/posts/${postId}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authStore.accessToken}`, // Добавляем токен авторизации
      },
    });

    if (response.ok) {
      posts.value = posts.value.filter((post) => post.id !== postId); // Удаляем пост из списка
    } else {
      console.error('Ошибка при удалении поста:', response.statusText);
    }
  } catch (error) {
    console.error('Ошибка сети при удалении поста:', error);
  }
};
</script>

<style scoped>
/* Простые стили для демонстрации, используя глобальные переменные */
.posts-container {
  padding: var(--spacing-large);
  max-width: 800px;
  margin: 0 auto;
  background-color: var(--surface-color);
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-medium);
}
.post-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-medium);
  margin-bottom: var(--spacing-large);
}
.form-control-alt {
  padding: var(--spacing-small);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: var(--border-radius);
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
  margin-bottom: var(--spacing-small);
}
.form-control-alt:focus {
  outline: none;
  border-color: var(--primary-light);
  box-shadow: 0 0 0 3px rgba(72, 149, 239, 0.25);
}
.posts-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-medium);
}
.post-card {
  padding: var(--spacing-large);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-small);
}
.post-card h3 {
  margin-top: 0;
  color: var(--text-color);
}
.post-meta {
  color: var(--text-light);
  font-size: 0.9em;
  margin-top: var(--spacing-small);
}
.btn-primary, .btn-danger {
  padding: var(--spacing-small) var(--spacing-medium);
  border: none;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-weight: var(--font-weight-bold);
}
.btn-primary {
  background-color: var(--primary-color);
  color: white;
}
.btn-primary:hover {
  background-color: var(--secondary-color);
}
.btn-danger {
  background-color: var(--danger-color);
  color: white;
}
.btn-danger:hover {
  background-color: #d90429;
}
.btn-sm {
  font-size: var(--font-size-small);
  padding: calc(var(--spacing-small) * 0.75) var(--spacing-small);
}
</style>