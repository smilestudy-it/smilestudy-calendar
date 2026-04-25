/**
 * （責務）プリセット操作時の time→HH:mm 正規化と API エラー文面化。
 * 授業プリセット画面の API エラー解釈と `<input type="time">` 正規化を担当。
 */

/** `<input type="time">` の値を API の `HH:mm` に揃える */
export function toHm(v: string): string {
  const parts = v.trim().split(':');
  if (parts.length >= 2) {
    const h = parts[0]?.padStart(2, '0') ?? '00';
    const m = (parts[1] ?? '00').slice(0, 2).padStart(2, '0');
    return `${h}:${m}`;
  }
  return v.trim();
}

export function presetMutationNetworkError(prefix: string, e: unknown): string {
  if (e instanceof Error) {
    return `${prefix}: ${e.message}`;
  }
  return 'ネットワークエラーが発生しました。';
}

export async function readPresetApiError(
  res: Response,
  options: { fallback: string; invalidRequestHint: string },
): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (body.message === 'invalid request') {
    return options.invalidRequestHint;
  }
  if (body.message) {
    return `${options.fallback}（${body.message}）`;
  }
  return options.fallback;
}
