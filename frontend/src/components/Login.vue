<script setup lang="ts">
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { zodResolver } from "@primevue/forms/resolvers/zod";
import { z } from 'zod';
import { useRouter } from 'vue-router';
import {
  backendServer
} from '../stores/auth.ts';

const router = useRouter();
const formSchema = z.object({
  username: z.string().min(2, { message: "Имя пользователя должно быть больше 3 символов." }),
  password: z.string().min(8, { message: "Пароль должен содержать не меньше 8 символов." }),
});
const resolver = zodResolver(formSchema);
const api_prefix: string = "/api/v1";
const redirect = "/auth/registration/";

async function loginUser(e: Object) {
  if (backendServer != undefined) {
    await fetch(
      'https://' + backendServer.address + api_prefix + '/auth/token/', {
      method: 'POST',
      cache: "reload",
      body: new URLSearchParams(e.values),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': backendServer.csrfToken
      },
      credentials: 'include',
    }).then(async function (response) {
      router.push('/');
    }).catch((err) => {
      let error: string = 'An error occurred during get users list : ' + err;
      console.log(error);
    });
  }
}
async function onFormSubmit(e: Object) {
  if (Object.keys(e.errors).length) {
    return;
  }
  await loginUser(e);
}
</script>

<template>
  <div class="cnt-login">
    <Form @submit="onFormSubmit" :resolver class="frm-login flex flex-col gap-4 w-full sm:w-80">
      <h3>Вход</h3>
      <FormField v-slot="$field" name="username" initialValue="" class="flex txt-login flex-col gap-1">
        <InputText type="text" class="txt-login" placeholder="Имя пользователя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="password" initialValue="" class="flex flex-col gap-1">
        <Password type="text" placeholder="Пароль" :feedback="false" toggleMask fluid />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <Button type="submit" class="btn-login" label="Войти" />
      <Button @click="router.push(redirect)" class="btn-login" label="Зарегистрироваться" severity="secondary"
        variant="text" />
    </Form>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>