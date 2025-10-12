<script setup lang="ts">
import { Form, type FormSubmitEvent } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import { zodResolver } from "@primevue/forms/resolvers/zod";
import { nullable, z } from 'zod';
import { backendServer } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { ref } from 'vue';

const formSchema = z.object({
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
const resolver = zodResolver(formSchema);
const router = useRouter();
const api_prefix: string = "/api/v1";
const result = ref("");
const severity = ref("success");
const redirect = "/auth/login/";

async function registerUser(e: FormSubmitEvent<Record<string, any>>) {
  if (backendServer != undefined) {
    await fetch(
      'https://' + backendServer.address + api_prefix + '/users/', {
      method: 'POST',
      cache: "reload",
      body: JSON.stringify(e.values),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': backendServer.csrfToken
      },
      credentials: 'include',
    }).then(async function (response) {
      result.value = (await response).statusText;
      severity.value = "success";
      // if (result.status == 200) {
      //   router.push('/auth/login/');
      // }
    }).catch((error) => {
      result.value = error;
      severity.value = "error";
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
      <FormField v-slot="$field" name="username" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Имя пользователя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="password" initialValue="" class="flex txt-register flex-col gap-1">
        <Password type="text" placeholder="Пароль" :feedback="false" class="txt-register" toggleMask fluid />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="password2" initialValue="" class="flex txt-register flex-col gap-1">
        <Password type="text" placeholder="Повторите пароль" class="txt-register" :feedback="false" toggleMask fluid />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="email" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Почта@gmail.com" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="first_name" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Имя" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="last_name" initialValue="" class="flex txt-register flex-col gap-1">
        <InputText type="text" class="txt-register" placeholder="Фамилия" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <FormField v-slot="$field" name="bio" class="flex txt-register flex-col gap-1">
        <Textarea class="txt-register" placeholder="Биография" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
        </Message>
      </FormField>
      <Message size="small" :severity variant="simple">{{ result }}</Message>
      <Button type="submit" class="btn-register" label="Зарегистрироваться" />
      <Button @click="router.push(redirect)" class="btn-register" label="Войти" severity="secondary" variant="text" />
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