import { backend_server } from "@/utils/network";
import type { Ref } from "vue";

export async function getItems(
  request_path: string,
  items: Ref<Array<Record<string, string>>, Array<Record<string, string>>>,
  result: Ref<string, string>
) {
  if (backend_server != undefined) {
    await fetch(
      'https://' + backend_server.address + request_path, {
      method: 'GET',
      cache: "reload",
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': backend_server.csrf_token
      },

      credentials: 'include',
    }).then(async function (response) {
      items.value = await response.json();
    }).catch((error) => {
      result.value = 'Ошибка при выполнении запроса: ' + error;
    });
  }

  return items;
}