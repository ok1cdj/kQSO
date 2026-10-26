// Build-time constants injected by Vite's `define` (see vite.config.ts).
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string // ISO 8601, UTC
// The ONNX runtime wasm the CW decoder downloads (ui/cw/worker.ts).
declare const __CW_ORT__: { file: string; bytes: number; sha256: string }
