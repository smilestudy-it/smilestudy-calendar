import type { ReactNode } from 'react';

type Props = {
  /** セクション見出し */
  title: string;
  children: ReactNode;
};

/**
 * 授業プリセット内の折り畳まない枠（科目 / 授業種別 / 時間枠で共通）
 */
export default function PresetSection({ title, children }: Props) {
  return (
    <section className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 md:p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-100">{title}</h3>
      {children}
    </section>
  );
}
