<script setup lang="ts">
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
</script>

<template>
  <Form :initialValues :resolver @submit="onFormSubmit" class="frm-login flex flex-col gap-4 w-full sm:w-80">
    <FormField v-slot="$field" name="username" initialValue="" :resolver="zodUserNameResolver"
      class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Логин" required />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="password1" initialValue="" :resolver="customPasswordResolver"
      class="flex flex-col gap-1">
      <Password type="text" placeholder="Пароль" :feedback="false" toggleMask fluid required />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="password2" initialValue="" :resolver="customPasswordResolver"
      class="flex flex-col gap-1">
      <Password type="text" placeholder="Повторите пароль" :feedback="false" toggleMask fluid required />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="firstname" initialValue="" :resolver="yupFirstNameResolver"
      class="flex txt-login flex-col gap-1">
      <InputText type="text" class="txt-login" placeholder="Имя" />
      <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}
      </Message>
    </FormField>
    <FormField v-slot="$field" name="lastname" initialValue="" :resolver="valibotLastNameResolver"
      class="flex txt-login flex-col gap-1">
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