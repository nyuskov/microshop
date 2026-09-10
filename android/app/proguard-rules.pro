# Правила ProGuard/R8. Минификация сейчас выключена (minifyEnabled false),
# правила добавлены на случай включения R8 в будущем.

# WebView + JavaScript-интерфейс (window.PismoNative) вызывается из JS по имени.
-keepclassmembers class space.pismo.app.MainActivity$NativeBridge {
    public *;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*

# RuStore Push SDK (собственные consumer-правила есть в AAR, оставлено для явности).
-keep class ru.rustore.sdk.pushclient.** { *; }
-dontwarn ru.rustore.sdk.pushclient.**
