<script setup lang="ts">
import { Form } from '@primevue/forms'
import { FormField } from '@primevue/forms'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Textarea from 'primevue/textarea'
import Password from 'primevue/password'
import { zodResolver } from '@primevue/forms/resolvers/zod'
import { z } from 'zod'
import { backendServer, getCSRFToken } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ref } from 'vue'

// Updated schema to include phone_number
const formSchema = z.object({
  username: z.string().min(2, { message: 'Имя пользователя должно быть больше 3 символов.' }),
  phone_number: z.string().optional(), // Phone number is optional
  email: z.string().email({ message: 'Неверный email-адрес.' }).optional().or(z.literal('')),
  password: z.string().min(8, { message: 'Пароль должен содержать не меньше 8 символов.' }),
  password2: z.string().min(8, { message: 'Пароль должен содержать не меньше 8 символов.' }),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  bio: z.string().optional()
})
// END Updated schema
const resolver = zodResolver(formSchema)
const router = useRouter()
const api_prefix: string = '/api/v1'
const result = ref('')
const severity = ref('success')
const redirect = '/auth/login/'

interface FormEventObject {
  values: Record<string, unknown>
  errors: Record<string, string[]>
  [key: string]: unknown // Allow other properties
}

async function registerUser(e: FormEventObject) {
  if (backendServer != undefined) {
    const csrfToken = getCSRFToken() // Get the CSRF token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    // Add the CSRF token to headers if it exists
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken
    }

    try {
      const response = await fetch(backendServer + api_prefix + '/users/', {
        method: 'POST',
        cache: 'reload',
        // Send only the values needed by the backend
        body: JSON.stringify({
          username: e.values.username,
          phone_number: e.values.phone_number || null, // Send null if empty
          email: e.values.email || null,
          password: e.values.password,
          first_name: e.values.first_name || null,
          last_name: e.values.last_name || null,
          bio: e.values.bio || null
        }),
        headers: headers,
        credentials: 'include'
      })

      console.log('Response status:', response.status) // Логирование статуса
      console.log('Response ok:', response.ok) // Логирование флага ok

      // Читаем тело ответа, чтобы получить потенциальные сообщения об ошибках
      const responseBody = await response.text()
      console.log('Response body:', responseBody) // Логирование тела ответа

      // Обновляем результат в зависимости от статуса
      result.value = `${response.status} ${response.statusText}`.trim()
      severity.value = response.ok ? 'success' : 'error'

      // Если статус 2xx (успешный), выполняем перенаправление
      if (response.ok) {
        console.log('Navigation to login triggered.') // Логирование перехода
        router.push('/auth/login/')
      }
    } catch (err) {
      console.error('Fetch error:', err) // Логирование ошибки fetch
      const error: string =
        'An error occurred during registration : ' +
        (err instanceof Error ? err.message : String(err))
      result.value = error
      severity.value = 'error'
    }
  }
}
async function onFormSubmit(e: FormEventObject) {
  if (Object.keys(e.errors).length) {
    return
  }
  await registerUser(e)
}
</script>

<template>
  <div class="cnt-register">
    <Form @submit="onFormSubmit" :resolver class="frm-login flex flex-col gap-4 w-full sm:w-80">
      <h3>Регистрация</h3>
      <FormField
        v-slot="$field"
        name="username"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <InputText type="text" class="txt-login" placeholder="Имя пользователя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <!-- NEW FIELD -->
      <FormField
        v-slot="$field"
        name="phone_number"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <InputText type="tel" class="txt-login" placeholder="Телефон (опционально)" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <!-- END NEW FIELD -->
      <FormField
        v-slot="$field"
        name="password"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <Password
          type="text"
          placeholder="Пароль"
          :feedback="false"
          class="txt-login"
          toggleMask
          fluid
        />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField
        v-slot="$field"
        name="password2"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <Password
          type="text"
          placeholder="Повторите пароль"
          class="txt-login"
          :feedback="false"
          toggleMask
          fluid
        />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="email" initialValue="" class="flex txt-login flex-col gap-1">
        <InputText type="email" class="txt-login" placeholder="Почта@gmail.com (опционально)" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField
        v-slot="$field"
        name="first_name"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <InputText type="text" class="txt-login" placeholder="Имя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField
        v-slot="$field"
        name="last_name"
        initialValue=""
        class="flex txt-login flex-col gap-1"
      >
        <InputText type="text" class="txt-login" placeholder="Фамилия" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="bio" class="flex txt-login flex-col gap-1">
        <Textarea class="txt-login" placeholder="Биография" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple"
          >{{ $field.error?.message }}
        </Message>
      </FormField>
      <Message size="small" :severity variant="simple">{{ result }}</Message>
      <Button type="submit" class="btn-login" label="Зарегистрироваться" />
      <Button
        @click="router.push(redirect)"
        class="btn-login"
        label="Войти"
        severity="secondary"
        variant="text"
      />
    </Form>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>