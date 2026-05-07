import { useEffect, useMemo, useState } from 'react';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventClickArg, EventInput } from '@fullcalendar/core/index.js';
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
  onFocusDateChange?: (date: Date) => void;
  onDateClick?: (date: Date) => void;
  onEventClick?: (event: CalendarEventClick) => void;
  selectedDate?: Date;
  showHeaderToolbar?: boolean;
  calendarKey?: string;
};

export default function MonthCalendar({
  focusDate,
  events = [],
  onFocusDateChange,
  onDateClick,
  onEventClick,
  selectedDate,
  showHeaderToolbar = false,
  calendarKey,
}: Props) {
  const [holidayDates, setHolidayDates] = useState<string[]>([]);
  const holidayDateSet = useMemo(() => new Set(holidayDates), [holidayDates]);

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
      key={calendarKey}
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      initialDate={focusDate}
      locale="ja"
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
      dayCellContent={(arg) => (
        <span className={getDateColorClass(arg.date)}>{arg.date.getDate()}</span>
      )}
      datesSet={(arg) => {
        if (!onFocusDateChange) {
          return;
        }
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
          ? ['bg-indigo-50', 'ring-1', 'ring-indigo-300', 'rounded-md']
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
