/**
 * （責務）プリセット設定内のセクション枠（見出し＋子）。
 */
import type { ReactNode } from 'react';

import { Separator } from '@/components/ui/separator';

type Props = {
  title: string;
  children: ReactNode;
};

export default function PresetSection({ title, children }: Props) {
  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {children}
      <Separator />
    </section>
  );
}
