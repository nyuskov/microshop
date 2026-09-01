<script setup>
import { ref, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';

const authStore = useAuthStore();
const router = useRouter();

const profileForm = reactive({ ...authStore.currentUser });
const newPassword = ref('');
const confirmNewPassword = ref('');

const updateProfile = async () => {
  if (newPassword.value !== confirmNewPassword.value) {
    alert('Новые пароли не совпадают!');
    return;
  }

  const updateData = { ...profileForm };
  if (newPassword.value) {
    updateData.password = newPassword.value;
  }

  try {
    await authStore.updateCurrentUser(updateData);
    router.push('/dashboard'); // Перенаправить после обновления
  } catch (error) {
    console.error('Ошибка обновления профиля:', error);
    alert('Не удалось обновить профиль.');
  }
};

// Пример данных для селектов
const languages = ref([
    { name: 'English', code: 'en' },
    { name: 'Russian', code: 'ru' },
    { name: 'Spanish', code: 'es' }
]);
const countries = ref([
    { name: 'Russia', code: 'RU' },
    { name: 'United States', code: 'US' },
    { name: 'Spain', code: 'ES' }
]);

</script>

<template>
  <div class="user-profile-container">
    <div class="card">
      <Toolbar class="toolbar">
          <template #start>
              <span class="toolbar-title">Настройки профиля</span>
          </template>
          <template #center>
              <!-- Пустой центр -->
          </template>
          <template #end>
              <Button label="Отмена" severity="secondary" outlined @click="router.go(-1)" />
              <Button label="Сохранить" icon="pi pi-check" @click="updateProfile" class="ml-2" />
          </template>
      </Toolbar>

      <div class="profile-content">
        <div class="profile-header">
          <Avatar :label="authStore.currentUser?.username?.charAt(0) || 'U'" size="large" shape="circle" class="profile-avatar" />
          <div class="profile-info">
            <h2>{{ authStore.currentUser?.username }}</h2>
            <p>{{ authStore.currentUser?.email }}</p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="username">Имя пользователя</label>
            <InputText id="username" v-model="profileForm.username" />
          </div>

          <div class="field">
            <label for="email">Email</label>
            <InputText id="email" v-model="profileForm.email" type="email" />
          </div>

          <div class="field">
            <label for="currentPassword">Текущий пароль</label>
            <Password id="currentPassword" v-model="profileForm.currentPassword" feedback toggleMask />
          </div>

          <div class="field">
            <label for="newPassword">Новый пароль</label>
            <Password id="newPassword" v-model="newPassword" feedback toggleMask />
          </div>

          <div class="field">
            <label for="confirmNewPassword">Подтвердите новый пароль</label>
            <Password id="confirmNewPassword" v-model="confirmNewPassword" feedback toggleMask />
          </div>

          <div class="field">
            <label for="phone">Номер телефона</label>
            <InputMask id="phone" mask="+7 (999) 999-99-99" v-model="profileForm.phone" />
          </div>

          <div class="field">
            <label for="bio">Биография</label>
            <Textarea id="bio" v-model="profileForm.bio" rows="4" cols="50" />
          </div>

          <div class="field">
            <label for="language">Язык</label>
            <Dropdown id="language" v-model="profileForm.language" :options="languages" optionLabel="name" placeholder="Выберите язык" />
          </div>

          <div class="field">
            <label for="country">Страна</label>
            <Dropdown id="country" v-model="profileForm.country" :options="countries" optionLabel="name" placeholder="Выберите страну" />
          </div>

          <div class="field">
            <label for="birthDate">Дата рождения</label>
            <Calendar id="birthDate" v-model="profileForm.birthDate" showIcon />
          </div>

          <div class="field checkbox-field">
            <TriStateCheckbox v-model="profileForm.notificationsEnabled" />
            <label for="notificationsEnabled" class="checkbox-label">Включить уведомления</label>
          </div>

          <div class="field checkbox-field">
            <TriStateCheckbox v-model="profileForm.privacyMode" />
            <label for="privacyMode" class="checkbox-label">Режим приватности</label>
          </div>

          <div class="field switch-field">
            <label for="accountType" class="switch-label">Тип аккаунта</label>
            <div class="switch-wrapper">
              <span>Бесплатный</span>
              <ToggleSwitch v-model="profileForm.isPremium" />
              <span>Премиум</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-profile-container {
  padding: var(--spacing-medium);
  max-width: 1200px;
  margin: 0 auto;
}

.toolbar {
  border: none !important; /* Переопределение PrimeVue */
  border-radius: var(--border-radius) var(--border-radius) 0 0 !important; /* Закругление сверху */
  padding: var(--spacing-medium) !important;
  background-color: var(--surface-color-dark) !important; /* Темный фон для тулбара */
  color: var(--text-color) !important;
  box-shadow: var(--shadow-small) !important; /* Тень */
}

.toolbar-title {
  font-size: var(--font-size-large);
  font-weight: var(--font-weight-bold);
  color: var(--text-color);
  margin: 0;
}

.profile-content {
  padding: var(--spacing-medium);
}

.profile-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--spacing-large);
  padding-bottom: var(--spacing-medium);
  border-bottom: 1px solid var(--border-color);
}

.profile-avatar {
  margin-right: var(--spacing-medium);
  background-color: var(--primary-color) !important; /* Цвет фона аватара */
  color: var(--md-on-primary) !important; /* Цвет текста аватара */
}

.profile-info h2 {
  margin: 0 0 var(--spacing-tiny) 0;
  color: var(--text-color);
}

.profile-info p {
  margin: 0;
  color: var(--text-light);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--spacing-medium);
}

.field {
  margin-bottom: var(--spacing-medium);
}

.field label {
  display: block;
  margin-bottom: var(--spacing-small);
  color: var(--text-color);
  font-weight: var(--font-weight-bold);
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-small);
}

.checkbox-label {
  margin: 0; /* Убираем отступы у label чекбокса */
  color: var(--text-color);
}

.switch-field {
  display: flex;
  flex-direction: column; /* Сначала метка, потом переключатель */
  gap: var(--spacing-small);
}

.switch-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-small);
  margin-top: var(--spacing-tiny); /* Отступ сверху для выравнивания */
}

.switch-label {
  color: var(--text-color);
  font-weight: var(--font-weight-bold);
}

/* Стили для PrimeVue компонентов */
.p-inputtext, .p-password, .p-inputmask, .p-textarea, .p-dropdown, .p-calendar {
  width: 100%;
  padding: var(--spacing-small);
  background-color: var(--surface-color) !important;
  color: var(--text-color) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: var(--border-radius) !important;
  transition: border-color 0.2s ease;
}

.p-inputtext:focus, .p-password:focus, .p-inputmask:focus, .p-textarea:focus, .p-dropdown:focus, .p-calendar:focus {
  outline: none !important;
  border-color: var(--primary-color) !important;
  box-shadow: 0 0 0 3px rgba(63, 81, 181, 0.2) !important; /* Glow effect */
}

.p-password {
  padding: 0 !important; /* Сброс padding для обертки Password */
}

.p-password input {
  width: 100%;
  padding: var(--spacing-small);
  border: none !important; /* Убираем внутреннюю границу у input Password */
  background-color: transparent !important; /* Прозрачный фон у input Password */
  color: inherit !important;
}

.p-password input:focus {
  box-shadow: none !important; /* Убираем внутреннюю тень у input Password */
}

.p-dropdown .p-dropdown-label, .p-calendar input {
  background-color: transparent !important;
  color: inherit !important;
  border: none !important;
  padding: 0 var(--spacing-small) !important; /* Добавим немного внутреннего отступа */
}

.p-button {
  min-width: 80px; /* Минимальная ширина для кнопок */
}
</style>