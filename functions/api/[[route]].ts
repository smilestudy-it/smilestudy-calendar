/**
 * （責務）Cloudflare Pages Functions の公式エントリ。app / onRequest を re-export。
 */
/**
 * Cloudflare Pages Functions エントリ。`app` 本体は {@link './app'}
 */

export { app, onRequest } from './app';
