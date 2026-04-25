/**
 * 診断用（Wrangler / ダッシュボードのログ）。クライアントには返さない
 */
export function collectErrorTextParts(error: unknown, depth = 0): string[] {
  if (depth > 6) {
    return [];
  }
  if (error instanceof Error) {
    const parts = [error.message];
    if (error.cause !== undefined) {
      parts.push(...collectErrorTextParts(error.cause, depth + 1));
    }
    return parts;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return [message];
    }
  }
  try {
    return [JSON.stringify(error)];
  } catch {
    return [String(error)];
  }
}

export function logApiError(routeLabel: string, err: unknown): void {
  const summary =
    collectErrorTextParts(err).join(' ') || (err instanceof Error ? err.message : String(err));
  console.error(`[api] ${routeLabel}: ${summary}`, err);
}
