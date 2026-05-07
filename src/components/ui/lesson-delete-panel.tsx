import dayjs from 'dayjs';
import { Button } from '@/components/ui/button';

export type LessonDeleteTarget = {
  id: string;
  title: string;
  start: Date | null;
  end: Date | null;
};

type Props = {
  event: LessonDeleteTarget | null;
  isDeleting: boolean;
  error: string | null;
  onClose: () => void;
  onDelete: () => void;
};

export default function LessonDeletePanel({
  event,
  isDeleting,
  error,
  onClose,
  onDelete,
}: Props) {
  if (!event) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-10px_30px_rgba(15,23,42,0.18)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">{event.title}</p>
          <p className="text-xs text-slate-600">
            {event.start ? dayjs(event.start).format('YYYY/MM/DD HH:mm') : '-'} -{' '}
            {event.end ? dayjs(event.end).format('HH:mm') : '-'}
          </p>
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isDeleting}>
            閉じる
          </Button>
          <Button
            type="button"
            className="bg-rose-700 text-white hover:bg-rose-600"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? '削除中...' : '削除'}
          </Button>
        </div>
      </div>
    </div>
  );
}
