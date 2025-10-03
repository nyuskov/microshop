<script setup lang="ts">
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import { zodResolver } from "@primevue/forms/resolvers/zod";
import { z } from 'zod';
import { backendServer } from '@/stores/auth';

const formSchema = z.object({
  username: z.string().min(2, { message: "Имя пользователя должно быть больше 3 символов." }),
  email: z.string().email({ message: "Неверный email-адрес." }),
  password: z.string().min(8, { message: "Пароль должен содержать не меньше 8 символов." }),
  password2: z.string().min(8, { message: "Пароль должен содержать не меньше 8 символов." }),
});
const resolver = zodResolver(formSchema);

async function registerUser(e: Object) {
  if (backendServer != undefined) {
    await fetch(
      'https://' + backendServer.address + '/users/', {
      method: 'POST',
      cache: "reload",
      body: JSON.stringify(e.values),
      headers: {
        'Content-Type': 'application/json',
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
  await registerUser(e);
}
</script>

<template>
  <Form @submit="onFormSubmit" :resolver class="frm-login flex flex-col gap-4 w-full sm:w-80">
    <FormField v-slot="$field" name="username" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Имя пользователя" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="password" initialValue="" class="flex txt-login flex-col gap-1">
      <Password type="text" placeholder="Пароль" :feedback="false" class="txt-login" toggleMask fluid />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="password2" initialValue="" class="flex txt-login flex-col gap-1">
      <Password type="text" placeholder="Повторите пароль" class="txt-login" :feedback="false" toggleMask fluid />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="email" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Почта@gmail.com" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="first_name" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Имя" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="last_name" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Фамилия" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="bio" class="flex txt-login flex-col gap-1">
      <Textarea class="txt-login" placeholder="Биография" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <Button type="submit" severity="secondary" class="btn-login" label="Зарегистрироваться" />
  </Form>
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
}

.btn-login {
  width: 100%;
}

.txt-login {
  width: 100%;
}
</style>