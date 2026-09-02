<script setup>
import { ref, reactive, computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useRouter } from "vue-router";

// Импорт компонентов PrimeVue
import Button from "primevue/button";
import Avatar from "primevue/avatar";
import Textarea from "primevue/textarea";
import InputText from "primevue/inputtext";
import InputMask from "primevue/inputmask";
import Calendar from "primevue/calendar";
import Dropdown from "primevue/dropdown";
import Password from "primevue/password";
import ToggleSwitch from "primevue/toggleswitch";

const authStore = useAuthStore();
const router = useRouter();

// Используем computed, чтобы profileForm всегда был синхронизирован с current_user
// Предполагаем, что данные с бэкенда в snake_case
const profileForm = computed(() =>
  authStore.current_user ? { ...authStore.current_user } : {},
);

const newPassword = ref("");
const confirmNewPassword = ref("");

const updateProfile = async () => {
  if (newPassword.value !== confirmNewPassword.value) {
    alert("Новые пароли не совпадают!");
    return;
  }

  // Создаем объект обновления, объединяя вычисленные значения из profileForm и новые пароли
  // Исключим currentPassword из обновления профиля, если оно не требуется бэкендом для этой операции
  const { currentPassword, ...profileDataToSend } = profileForm.value;
  const updateData = { ...profileDataToSend };

  if (newPassword.value) {
    updateData.new_password = newPassword.value; // Предполагаем, что бэкенд принимает new_password
  }

  try {
    // Вызываем обновленный метод из store
    await authStore.updateCurrentUser(updateData);
    // После успешного обновления можно показать сообщение и, возможно, остаться на странице
    alert("Профиль успешно обновлен!");
    // router.push('/dashboard'); // Закомментировано, чтобы остаться на странице профиля
  } catch (error) {
    console.error("Ошибка обновления профиля:", error);
    let errorMessage = "Не удалось обновить профиль.";
    if (error.response && error.response.data) {
      errorMessage += ` Сервер сообщил: ${JSON.stringify(error.response.data)}`;
    }
    alert(errorMessage);
  }
};

// Пример данных для селектов
const languages = ref([
  { name: "English", code: "en" },
  { name: "Russian", code: "ru" },
  { name: "Spanish", code: "es" },
]);
const countries = ref([
  { name: "Russia", code: "RU" },
  { name: "United States", code: "US" },
  { name: "Spain", code: "ES" },
]);
</script>

<template>
  <div class="profile-container">
    <div class="profile-card">
      <div class="profile-toolbar">
        <h2 class="toolbar-title">Настройки профиля</h2>
        <div class="toolbar-buttons">
          <!-- Кнопка "Назад" с иконкой и текстом -->
          <Button
            label="Назад"
            icon="pi pi-arrow-left"
            severity="secondary"
            @click="router.go(-1)"
            class="btn-secondary btn-with-icon"
          />
          <!-- Кнопка "Сохранить" с иконкой и текстом -->
          <Button
            label="Сохранить"
            icon="pi pi-save"
            @click="updateProfile"
            class="btn-primary ml-2 btn-with-icon"
          />
        </div>
      </div>

      <!-- Индикатор загрузки, если current_user еще нет -->
      <div v-if="!authStore.current_user" class="loading-message">
        Загрузка данных пользователя...
      </div>

      <!-- Основной контент, если данные пользователя загружены -->
      <div v-else class="profile-content">
        <div class="profile-section">
          <div class="profile-header">
            <Avatar
              :label="authStore.current_user?.username?.charAt(0) || 'U'"
              size="large"
              shape="circle"
              class="profile-avatar"
            />
            <div class="profile-info">
              <h3>
                {{ authStore.current_user?.username || "Имя не указано" }}
              </h3>
              <p>{{ authStore.current_user?.email || "Email не указан" }}</p>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="bio" class="form-label">Биография</label>
              <Textarea
                id="bio"
                v-model="profileForm.bio"
                rows="4"
                cols="50"
                class="form-input form-textarea"
              />
            </div>
          </div>
        </div>

        <div class="profile-section">
          <h4 class="section-title">Личная информация</h4>
          <div class="form-grid">
            <div class="form-field">
              <label for="username" class="form-label">Имя пользователя</label>
              <InputText
                id="username"
                v-model="profileForm.username"
                class="form-input"
              />
            </div>
            <div class="form-field">
              <label for="email" class="form-label">Email</label>
              <InputText
                id="email"
                v-model="profileForm.email"
                type="email"
                class="form-input"
              />
            </div>
            <div class="form-field">
              <label for="phone" class="form-label">Номер телефона</label>
              <InputMask
                id="phone"
                mask="+7 (999) 999-99-99"
                v-model="profileForm.phone"
                class="form-input"
              />
            </div>
            <div class="form-field">
              <label for="birthDate" class="form-label">Дата рождения</label>
              <Calendar
                id="birthDate"
                v-model="profileForm.birth_date"
                showIcon
                class="form-input"
              />
            </div>
            <div class="form-field">
              <label for="language" class="form-label">Язык</label>
              <Dropdown
                id="language"
                v-model="profileForm.language"
                :options="languages"
                optionLabel="name"
                placeholder="Выберите язык"
                class="form-select"
              />
            </div>
            <div class="form-field">
              <label for="country" class="form-label">Страна</label>
              <Dropdown
                id="country"
                v-model="profileForm.country"
                :options="countries"
                optionLabel="name"
                placeholder="Выберите страну"
                class="form-select"
              />
            </div>
          </div>
        </div>

        <div class="profile-section">
          <h4 class="section-title">Безопасность</h4>
          <div class="form-grid">
            <!-- Поле "Текущий пароль" не привязано к profileForm, используется отдельно, если нужно для смены пароля -->
            <!-- <div class="form-field">
              <label for="currentPassword" class="form-label">Текущий пароль</label>
              <Password id="currentPassword" v-model="profileForm.current_password" feedback toggleMask class="form-input-password" placeholder="Введите текущий пароль" />
            </div> -->
            <div class="form-field">
              <label for="newPassword" class="form-label">Новый пароль</label>
              <Password
                id="newPassword"
                v-model="newPassword"
                feedback
                toggleMask
                class="form-input-password"
                placeholder="Введите новый пароль"
              />
            </div>
            <div class="form-field">
              <label for="confirmNewPassword" class="form-label"
                >Подтвердите новый пароль</label
              >
              <Password
                id="confirmNewPassword"
                v-model="confirmNewPassword"
                feedback
                toggleMask
                class="form-input-password"
                placeholder="Подтвердите новый пароль"
              />
            </div>
          </div>
        </div>

        <div class="profile-section">
          <h4 class="section-title">Настройки</h4>
          <div class="settings-grid">
            <div class="setting-item">
              <div class="setting-label">Включить уведомления</div>
              <ToggleSwitch
                v-model="profileForm.notifications_enabled"
                class="toggle-switch"
              />
            </div>
            <div class="setting-item">
              <div class="setting-label">Режим приватности</div>
              <ToggleSwitch
                v-model="profileForm.privacy_mode"
                class="toggle-switch"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-container {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  background-color: #ffffff; /* Основной фон как на дизайне */
  color: #333333; /* Основной цвет текста */
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu,
    Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
}

.profile-card {
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.profile-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background-color: #f8f9fa; /* Светлый фон для тулбара */
  border-bottom: 1px solid #e0e0e0;
}

.toolbar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #333333;
}

.toolbar-buttons {
  display: flex;
  gap: 8px;
}

.btn-primary {
  background-color: #007bff; /* Синий цвет для основной кнопки */
  border: 1px solid #007bff;
  color: white;
}

.btn-primary:hover {
  background-color: #0056b3;
  border-color: #0056b3;
}

.btn-secondary {
  background-color: #ffffff;
  border: 1px solid #ced4da;
  color: #6c757d;
}

.btn-secondary:hover {
  background-color: #f8f9fa;
  color: #495057;
}

/* Стили для кнопок с иконками */
.btn-with-icon {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ml-2 {
  margin-left: 0.5rem;
}

.loading-message {
  padding: 24px;
  text-align: center;
  font-style: italic;
  color: #6c757d;
}

.profile-content {
  padding: 24px;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 32px; /* Отступ между секциями */
}

.profile-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.profile-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.profile-avatar {
  background-color: #007bff !important;
  color: white !important;
}

.profile-info h3 {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333333;
}

.profile-info p {
  margin: 0;
  font-size: 14px;
  color: #6c757d;
}

.section-title {
  margin: 0;
  padding: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333333;
  border-bottom: 1px solid #e0e0e0;
}

.form-grid,
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 14px;
  font-weight: 500;
  color: #333333;
  margin-bottom: 4px;
}

.form-input,
.form-input-password,
.form-textarea,
.form-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  background-color: #ffffff;
  color: #333333;
  font-size: 14px;
  transition: border-color 0.2s ease;
}

.form-input:focus,
.form-input-password:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25);
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #e0e0e0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 14px;
  color: #333333;
  font-weight: 500;
}

.toggle-switch {
  /* Стили для ToggleSwitch будут зависеть от PrimeVue */
  /* Основные стили PrimeVue можно переопределить здесь при необходимости */
  /* Пример: увеличение размера */
  /* width: 50px; height: 28px; */
}

.toggle-with-labels {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #333333;
}
</style>
