import { useEffect, useMemo, useState } from 'react';

import type { EventClickArg, EventInput } from '@fullcalendar/core/index.js';
import jaLocale from '@fullcalendar/core/locales/ja';
import dayGridPlugin from '@fullcalendar/daygrid';
import FullCalendar from '@fullcalendar/react';

type CalendarEventClick = {
  id: string;
  title: string;
  start: Date | null;
  end: Date | null;
};

type Props = {
  focusDate: Date;
  events?: EventInput[];
  closureDates?: string[];
  onFocusDateChange?: (date: Date) => void;
  onDateClick?: (date: Date) => void;
  onEventClick?: (event: CalendarEventClick) => void;
  selectedDate?: Date;
  showHeaderToolbar?: boolean;
  calendarKey?: string;
};

/**
 * Renders a Japanese month calendar with holidays, closure dates, events, and optional date selection and navigation callbacks.
 *
 * @param focusDate - The month to display initially.
 * @param events - Calendar events to display.
 * @param closureDates - Dates marked as closed in `YYYY-MM-DD` format.
 * @param onFocusDateChange - Called when the displayed month changes.
 * @param onDateClick - Called when a day cell is clicked.
 * @param onEventClick - Called when a calendar event is clicked.
 * @param selectedDate - The date to highlight.
 * @param showHeaderToolbar - Whether to display previous, title, and next controls.
 * @param calendarKey - Optional key used to control calendar remounting.
 */
export default function MonthCalendar({
  focusDate,
  events = [],
  closureDates = [],
  onFocusDateChange,
  onDateClick,
  onEventClick,
  selectedDate,
  showHeaderToolbar = false,
  calendarKey,
}: Props) {
  const [holidayDates, setHolidayDates] = useState<string[]>([]);
  const holidayDateSet = useMemo(() => new Set(holidayDates), [holidayDates]);
  const closureDateSet = useMemo(() => new Set(closureDates), [closureDates]);

  const toDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  useEffect(() => {
    let isDisposed = false;
    const loadHolidays = async () => {
      try {
        const qs = new URLSearchParams({
          year: String(focusDate.getFullYear()),
          month: String(focusDate.getMonth() + 1),
        });
        const res = await fetch(`/api/public/holidays?${qs}`);
        if (!res.ok || isDisposed) {
          if (!isDisposed) {
            setHolidayDates([]);
          }
          return;
        }
        const data = (await res.json()) as Array<{ date: string }>;
        if (!isDisposed) {
          setHolidayDates(data.map((x) => x.date));
        }
      } catch {
        if (!isDisposed) {
          setHolidayDates([]);
        }
      }
    };
    void loadHolidays();
    return () => {
      isDisposed = true;
    };
  }, [focusDate]);

  const getDateColorClass = (date: Date) => {
    if (holidayDateSet.has(toDateKey(date)) || date.getDay() === 0) {
      return 'text-red-500';
    }
    if (date.getDay() === 6) {
      return 'text-blue-500';
    }
    return '';
  };

  return (
    <FullCalendar
      key={calendarKey ?? `${focusDate.getFullYear()}-${focusDate.getMonth()}`}
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      initialDate={focusDate}
      locale="ja"
      locales={[jaLocale]}
      height="auto"
      fixedWeekCount={false}
      eventDisplay="block"
      displayEventTime={false}
      eventClassNames={['text-center']}
      headerToolbar={
        showHeaderToolbar
          ? {
              left: 'prev',
              center: 'title',
              right: 'next',
            }
          : false
      }
      events={events}
      dayCellContent={(arg) => {
        const isClosure = closureDateSet.has(toDateKey(arg.date));
        return (
          <div className="flex flex-col items-center leading-none">
            <span className={getDateColorClass(arg.date)}>
              {arg.date.getDate()}
            </span>
            {isClosure && (
              <span className="mt-0.5 text-xs font-bold text-red-500">休</span>
            )}
          </div>
        );
      }}
      datesSet={(arg) => {
        if (!onFocusDateChange) {
          return;
        }
        // currentStart = 表示中の月の1日。activeStart はグリッド先頭（前月）になり得る。
        const next = arg.view.currentStart;
        if (
          next.getFullYear() !== focusDate.getFullYear() ||
          next.getMonth() !== focusDate.getMonth()
        ) {
          onFocusDateChange(next);
        }
      }}
      dayCellClassNames={(arg) =>
        selectedDate && arg.date.toDateString() === selectedDate.toDateString()
          ? ['bg-accent', 'ring-1', 'ring-ring', 'rounded-md']
          : []
      }
      dayCellDidMount={(arg) => {
        if (!onDateClick) {
          return;
        }
        arg.el.style.cursor = 'pointer';
        arg.el.onclick = () => onDateClick(arg.date);
      }}
      eventClick={(arg: EventClickArg) => {
        if (!onEventClick) {
          return;
        }
        onEventClick({
          id: arg.event.id,
          title: arg.event.title,
          start: arg.event.start,
          end: arg.event.end,
        });
      }}
    />
  );
}
