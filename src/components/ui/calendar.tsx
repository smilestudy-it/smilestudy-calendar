import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ja } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/** 日付はブラウザのローカルタイムゾーンで解釈（daypicker + date-fns locale） */
function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      locale={ja}
      className={cn('rounded-lg border border-slate-700 bg-slate-950 p-3 text-slate-100', className)}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
