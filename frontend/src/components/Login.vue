<script setup lang="ts">
import { Form } from '@primevue/forms'
import { FormField } from '@primevue/forms'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Password from 'primevue/password'
import { zodResolver } from '@primevue/forms/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth' // Импортируем store
import { ref } from 'vue'

const router = useRouter()
const authStore = useAuthStore() // Инициализируем store

const formSchema = z.object({
  username: z.string(),
  password: z.string()
})
const resolver = zodResolver(formSchema)
const severity = ref('success')
const result = ref('')

interface FormEventObject {
  values: Record<string, unknown>
  errors: Record<string, string[]>
  [key: string]: unknown // Allow other properties
}

async function onFormSubmit(e: FormEventObject) {
  if (Object.keys(e.errors).length) {
    return
  }

  const { username, password } = e.values

  try {
    // Вызываем login из store
    await authStore.login(username as string, password as string, router)
    result.value = 'Login successful'
    severity.value = 'success'
  } catch (error: unknown) {
    console.error('Login failed:', error)
    // Пытаемся получить сообщение об ошибке от бэкенда
    let errorMessage = 'Login failed. Please check your credentials.'
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      error.response.data &&
      error.response.data.detail
    ) {
      errorMessage = error.response.data.detail
    } else if (error && typeof error === 'object' && 'message' in error && error.message) {
      errorMessage = error.message
    }
    result.value = errorMessage
    severity.value = 'error'
  }
}
</script>

<template>
  <div class="cnt-login">
    <Form @submit="onFormSubmit" :resolver class="frm-login flex flex-col gap-4 w-full sm:w-80">
      <h3>Вход</h3>
      <FormField
        v-slot="$field"
        name="username"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <InputText type="text" class="txt-login" placeholder="Имя пользователя или телефон" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField
        v-slot="$field"
        name="password"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <Password class="txt-login" placeholder="Пароль" toggleMask :feedback="false" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <Button type="submit" label="Войти" class="btn-login" severity="secondary"></Button>
      <Message v-if="result" :severity="severity" size="small" variant="simple">
        {{ result }}
      </Message>
    </Form>
    <div class="reg-link">
      <span>Нет аккаунта?</span>
      <a href="/auth/registration/">Зарегистрироваться</a>
    </div>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>
<style scoped>
.reg-link {
  position: fixed;
  bottom: 2rem;
  font-size: 0.8rem;
}

.reg-link a {
  color: var(--primary-color);
  margin-left: 0.5rem;
  text-decoration: none;
}
</style>
