/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Baked in at BUILD time by the Dockerfile's VITE_API_URL build arg. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
