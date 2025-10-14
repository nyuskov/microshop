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

const authStore = useAuthStore();
const router = useRouter();
const formSchema = z.object({
  username: z.string(),
  password: z.string(),
});
const resolver = zodResolver(formSchema);
const redirectPath: string = "/auth/register/";
const severity: Ref<string, string> = ref("success");
const result: Ref<string, string> = ref("");

async function onFormSubmit(e: FormSubmitEvent<Record<string, any>>) {
  if (Object.keys(e.errors).length) {
    return;
  }
  await authStore.login(
    e.values["username"],
    e.values["password"],
  );
  result.value = authStore.result["message"];
  if (authStore.result["status"]) {
    severity.value = "success";
    authStore.result = null;
    router.push("/");
  } else {
    severity.value = "error";
    authStore.result = null;
  }
}
</script>

<template>
  <div class="cnt-login">
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
      <Message size="small" :severity variant="simple">{{ result }}</Message>
      <Button type="submit" class="btn-login" label="Войти" />
      <Button @click="router.push(redirectPath)" class="btn-login" label="Зарегистрироваться" severity="secondary"
        variant="text" />
    </Form>
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