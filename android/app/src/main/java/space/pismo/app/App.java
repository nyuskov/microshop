package space.pismo.app;

import android.app.Application;

/**
 * Точка входа приложения.
 *
 * Push-клиент RuStore инициализируется автоматически content-provider'ом SDK
 * ({@code ru.rustore.sdk.pushclient.provider.RuStorePushClientInitProvider}) по
 * метаданным {@code ru.rustore.sdk.pushclient.project_id} из AndroidManifest.xml,
 * поэтому ручной {@code RuStorePushClient.init()} здесь не вызывается.
 *
 * Задача класса — создать каналы уведомлений до того, как прилетит первый push
 * (Android 8+ не покажет уведомление, если канала ещё нет).
 */
public class App extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        PushChannels.ensure(this);
    }
}
