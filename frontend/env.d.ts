/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin бэкенда (без слэша), напр. https://localhost:8000. По умолчанию берётся из window.location. */
  readonly VITE_API_ORIGIN?: string
  /** Ключ Giphy API для панели GIF. */
  readonly VITE_GIPHY_API_KEY?: string
  /** JSON-массив ICE-серверов WebRTC (STUN/TURN), см. config.ts. */
  readonly VITE_ICE_SERVERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
