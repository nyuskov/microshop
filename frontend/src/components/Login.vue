<script setup lang="ts">
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';

const props = defineProps({
  backendServer: Object,
});

async function registerUser(e) {
  if (props.backendServer != undefined) {
    await fetch(
      'https://' + props.backendServer.address + '/users/', {
      method: 'POST',
      cache: "reload",
      body: JSON.stringify(e.values),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': props.backendServer.csrfToken
      },
      credentials: 'include',
    }).then(async function (response) {
      let result = await response.json();
      console.log(result);
    }).catch((err) => {
      let error: string = 'An error occurred during get users list : ' + err;
      console.log(error);
    });
  }
}
async function onFormSubmit(e) {
  await registerUser(e);
}
</script>

<template>
  <Form @submit="onFormSubmit" class="frm-login flex flex-col gap-4 w-full sm:w-80">
    <FormField v-slot="$field" name="username" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Логин" required />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="password" initialValue="" class="flex flex-col gap-1">
      <Password type="text" placeholder="Пароль" :feedback="false" toggleMask fluid required />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="password2" initialValue="" class="flex flex-col gap-1">
      <Password type="text" placeholder="Повторите пароль" :feedback="false" toggleMask fluid required />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="firstname" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Имя" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="lastname" initialValue="" class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Фамилия" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="details" class="flex txt-login flex-col gap-1">
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