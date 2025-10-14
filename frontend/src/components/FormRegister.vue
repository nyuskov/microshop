<script setup lang="ts">
import { Form, type FormSubmitEvent } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import { zodResolver } from "@primevue/forms/resolvers/zod";
import { z } from 'zod';
import { backend_server } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { ref } from 'vue';

const form_schema = z.object({
  username: z.string().min(2, { message: "Имя пользователя должно быть больше 3 символов." }),
  email: z.email({ message: "Неверный email-адрес." }),
  password: z.string().min(8, { message: "Пароль должен содержать не меньше 8 символов." }),
  password2: z.string().min(8, { message: "Пароль должен содержать не меньше 8 символов." }),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  bio: z.string().nullable(),
}).refine(
  data => data.password !== data.password2 ? false : true,
  { "message": "Пароли не совпадают.", path: ["password2"] });

const resolver = zodResolver(form_schema);
const $router = useRouter();
const request_path: string = "/api/v1/users/";
const _result = ref("");
const _severity = ref("success");
const redirect_path = "/auth/login/";

async function registerUser(e: FormSubmitEvent<Record<string, any>>) {
  if (backend_server != undefined) {
    await fetch(
      'https://' + backend_server.address + request_path, {
      method: 'POST',
      cache: "reload",
      body: JSON.stringify(e.values),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': backend_server.csrf_token
      },
      credentials: 'include',
    }).then(async function (response) {
      _result.value = (await response).statusText;
      _severity.value = "success";
    }).catch((error) => {
      _result.value = error;
      _severity.value = "error";
    });
  }
}

async function onFormSubmit(e: FormSubmitEvent<Record<string, any>>) {
  if (Object.keys(e.errors).length) {
    return;
  }
  await registerUser(e);
}
</script>

<template>
  <div class="cnt-register">
    <Form @submit="onFormSubmit" :resolver class="frm-register flex flex-col gap-4 w-full sm:w-80">
      <h3>Регистрация</h3>
      <FormField #="$field" name="username" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Имя пользователя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="password" initialValue="" class="flex txt-register flex-col gap-1">
        <Password type="text" placeholder="Пароль" :feedback="false" class="txt-register" toggleMask fluid />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="password2" initialValue="" class="flex txt-register flex-col gap-1">
        <Password type="text" placeholder="Повторите пароль" class="txt-register" :feedback="false" toggleMask fluid />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="email" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Почта@gmail.com" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="first_name" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Имя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="last_name" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Фамилия" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="bio" class="flex txt-register flex-col gap-1">
        <Textarea class="txt-register" placeholder="Биография" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <Message size="small" :severity="_severity" variant="simple">{{ _result }}</Message>
      <Button type="submit" class="btn-register" label="Зарегистрироваться" />
      <Button @click="$router.push(redirect_path)" class="btn-register" label="Войти" severity="secondary"
        variant="text" />
    </Form>
  </div>
</template>

<style scoped>
/* Form */
.frm-register {
  -webkit-box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  -moz-box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  align-items: center;
  box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.btn-register {
  width: 100%;
}

.cnt-register {
  align-items: center;
  display: flex;
  justify-content: center;
  height: 100vh;
}

.cnt-register .frm-register {
  width: 50%;
}

.txt-register {
  resize: none;
  width: 100%;
}
</style>