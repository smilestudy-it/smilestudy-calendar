/**
 * （責務）背景 HEX に対して読みやすい前景色（白 / 濃色）を返す。
 */

/** WCAG 相対輝度に基づき、背景上でコントラストの良い文字色を選ぶ */
export function readableTextOnHex(
  backgroundHex: string,
): '#ffffff' | '#111827' {
  const match = /^#([0-9a-fA-F]{6})$/.exec(backgroundHex.trim());
  if (!match) {
    return '#ffffff';
  }
  const n = Number.parseInt(match[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? '#111827' : '#ffffff';
}
