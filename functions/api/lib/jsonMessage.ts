/**
 * （責務）API 一貫の JSON エラーレスポンス { message } を返す薄いヘルパ。
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * API クライアント向けの短い `message` のみ返す（既存スキーマを維持）
 * サーバー診断は `logApiError` 等で行う
 */
export function jsonMessage(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
): Response {
  return c.json({ message }, status);
}
