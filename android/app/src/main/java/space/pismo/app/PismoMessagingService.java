package space.pismo.app;

import android.util.Log;

import java.util.List;

import ru.rustore.sdk.pushclient.messaging.exception.RuStorePushClientException;
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage;
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService;

/**
 * Приём push-уведомлений RuStore.
 *
 * Сервис подключается к SDK по action {@code ru.rustore.sdk.pushclient.MESSAGING_EVENT}
 * (см. AndroidManifest.xml). Само уведомление показывает SDK по параметрам push
 * (заголовок/текст/канал/иконка), наша задача — отдать новый токен наверх и, если
 * приложение открыто, сразу обновить интерфейс данными push.
 */
public class PismoMessagingService extends RuStoreMessagingService {

    private static final String TAG = "PismoPush";

    @Override
    public void onCreate() {
        super.onCreate();
        // Каналы нужны до первого показа уведомления.
        PushChannels.ensure(this);
    }

    @Override
    public void onNewToken(String token) {
        Log.i(TAG, "Получен новый push-токен RuStore");
        PushTokenStore.save(this, token);
        // Если страница открыта — она сразу зарегистрирует токен на сервере.
        WebBridge.sendPushToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        // Уведомление рисует SDK; данные отдаём странице (она обновит чат/ленту).
        WebBridge.sendPushData(message.getData());
    }

    @Override
    public void onDeletedMessages() {
        Log.i(TAG, "Часть push-сообщений не доставлена (истёк TTL)");
    }

    @Override
    public void onError(List<? extends RuStorePushClientException> errors) {
        for (RuStorePushClientException error : errors) {
            Log.w(TAG, "Ошибка push-клиента RuStore: " + error);
        }
        WebBridge.sendPushStatus(
                "error",
                errors.isEmpty() ? null : errors.get(0).getClass().getSimpleName());
    }
}
