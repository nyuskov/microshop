import { backend_server } from "@/utils/network";
import type { FormSubmitEvent } from "@primevue/forms";
import type { Ref } from "vue";

export async function register(
    e: FormSubmitEvent<Record<string, any>>,
    request_path: string,
    result: Ref<string, string>,
    severity: Ref<string, string>) {
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
        }).then((response) => {
            result.value = response.statusText;
            severity.value = "success";
        }).catch((error) => {
            result.value = error;
            severity.value = "error";
        });
    }
}