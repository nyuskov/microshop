<script setup lang="ts">
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { zodResolver } from "@primevue/forms/resolvers/zod";
import { z } from 'zod';
import {
  backendServer
} from '../stores/auth.ts';

const formSchema = z.object({
  username: z.string().min(2, { message: "Имя пользователя должно быть больше 3 символов." }),
  password: z.string().min(8, { message: "Пароль должен содержать не меньше 8 символов." }),
});
const resolver = zodResolver(formSchema);
const api_prefix: string = "/api/v1";

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
      let result = await response.json();
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
      <Button type="submit" severity="secondary" class="btn-login" label="Войти" />
    </Form>
  </div>
</template>

<style scoped>
.frm-login {
  -webkit-box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  -moz-box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  align-items: center;
  box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 5px;
  width: 250px;
}

.btn-login {
  width: 100%;
}

.cnt-login {
  align-items: center;
  display: flex;
  justify-content: center;
  height: 100vh;
}

.txt-login {
  width: 100%;
}
</style>