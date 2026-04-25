/**
 * （責務）汎用ユーティリティ（cn 等）。shadcn / Tailwind 向けのクラス結合など。
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
