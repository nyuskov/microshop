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
        class="post-input"
      />
      <textarea
        v-model="newPostBody"
        placeholder="Текст поста"
        required
        class="post-textarea"
      ></textarea>
      <button type="submit" class="btn-primary">Опубликовать</button>
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
/* Простые стили для демонстрации */
.posts-container {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}
.post-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.post-input, .post-textarea {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.post-textarea {
  min-height: 100px;
  resize: vertical;
}
.posts-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.post-card {
  padding: 15px;
  border: 1px solid #eee;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.post-card h3 {
  margin-top: 0;
}
.post-meta {
  color: #666;
  font-size: 0.9em;
  margin-top: 10px;
}
.btn-primary, .btn-danger {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-danger {
  background-color: #dc3545;
  color: white;
}
.btn-sm {
  font-size: 0.8em;
  padding: 4px 8px;
}
</style>