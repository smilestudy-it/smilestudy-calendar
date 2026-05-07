import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventInput } from '@fullcalendar/core/index.js';
import FullCalendar from '@fullcalendar/react';

type Props = {
  focusDate: Date;
  events?: EventInput[];
  onFocusDateChange?: (date: Date) => void;
  onDateClick?: (date: Date) => void;
  selectedDate?: Date;
  showHeaderToolbar?: boolean;
  calendarKey?: string;
};

export default function MonthCalendar({
  focusDate,
  events = [],
  onFocusDateChange,
  onDateClick,
  selectedDate,
  showHeaderToolbar = false,
  calendarKey,
}: Props) {
  return (
    <FullCalendar
      key={calendarKey}
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      initialDate={focusDate}
      locale="ja"
      height="auto"
      fixedWeekCount={false}
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
    />
  );
}
