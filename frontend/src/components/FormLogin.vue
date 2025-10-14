<script setup lang="ts">
import { Form, type FormSubmitEvent } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { zodResolver } from "@primevue/forms/resolvers/zod";
import { z } from 'zod';
import { useRouter } from 'vue-router';
import {
  useAuthStore
} from '../stores/auth.ts';
import { ref, type Ref } from 'vue';

const $auth_store = useAuthStore();
const $router = useRouter();
const form_schema = z.object({
  username: z.string(),
  password: z.string(),
});
const resolver = zodResolver(form_schema);
const redirect_path: string = "/auth/register/";
const _severity: Ref<string, string> = ref("success");
const _result: Ref<string, string> = ref("");

async function onFormSubmit(e: FormSubmitEvent<Record<string, any>>) {
  if (Object.keys(e.errors).length) {
    return;
  }
  await $auth_store.login(
    e.values["username"],
    e.values["password"],
  );
  _result.value = $auth_store.result["message"];
  if ($auth_store.result["status"]) {
    _severity.value = "success";
    $auth_store.result = null;
    $router.push("/");
  } else {
    _severity.value = "error";
    $auth_store.result = null;
  }
}

async function logout() {
  await $auth_store.logout();
}
</script>

<template>
  <div class="cnt-login" v-if="!$auth_store.is_authenticated">
    <Form @submit="onFormSubmit" :resolver class="frm-login flex flex-col gap-4 w-full sm:w-80">
      <h3>Вход</h3>
      <FormField #="$field" name="username" initialValue="" class="flex txt-login flex-col gap-1">
        <InputText type="text" class="txt-login" placeholder="Имя пользователя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField #="$field" name="password" initialValue="" class="flex txt-login flex-col gap-1">
        <Password type="text" class="txt-login" placeholder="Пароль" :feedback="false" toggleMask fluid />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <Message size="small" :severity="_severity" variant="simple">{{ _result }}</Message>
      <Button type="submit" class="btn-login" label="Войти" />
      <Button @click="$router.push(redirect_path)" class="btn-login" label="Зарегистрироваться" severity="secondary"
        variant="text" />
    </Form>
  </div>
  <div class="cnt-login" v-if="$auth_store.is_authenticated">
    <Button @click="logout" class="btn-login" label="Выйти" severity="secondary" variant="text" />
  </div>
</template>

<style scoped>
/* Form */
.frm-login {
  -webkit-box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  -moz-box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  align-items: center;
  box-shadow: 0px 0px 8px 0px rgba(34, 60, 80, 0.2);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
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
  resize: none;
  width: 100%;
}
</style>