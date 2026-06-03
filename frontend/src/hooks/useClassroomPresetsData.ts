/**
 * （責務）1 教室の subject / lesson-type / time-slot を並列取得するフック用ロジック。
 */
import { useCallback } from 'react';

import type { AuthedFetch } from '@/hooks/useAuthedFetch';
import type {
  LessonTypeListItem,
  SubjectListItem,
  TimeSlotListItem,
} from '@/types/api';

/**
 * 1 教室の subject / lesson-type / time-slot をまとめて取得（週次プリセット取得と同系統）。
 * `signal` によるキャンセルに対応。
 */
export function useClassroomPresetsData(authedFetch: AuthedFetch) {
  return useCallback(
    async (classroomId: string, signal?: AbortSignal) => {
      const [sRes, lRes, tRes] = await Promise.all([
        authedFetch(`/api/subjects/${encodeURIComponent(classroomId)}`, {
          signal,
        }),
        authedFetch(`/api/lesson-types/${encodeURIComponent(classroomId)}`, {
          signal,
        }),
        authedFetch(
          `/api/time-slots/${encodeURIComponent(classroomId)}`,
          { signal },
        ),
      ]);
      if (!sRes.ok || !lRes.ok || !tRes.ok) {
        return {
          ok: false as const,
          subjects: [] as SubjectListItem[],
          lessonTypes: [] as LessonTypeListItem[],
          timeSlots: [] as TimeSlotListItem[],
        };
      }
      const [subjects, lessonTypes, timeSlots] = await Promise.all([
        sRes.json() as Promise<SubjectListItem[]>,
        lRes.json() as Promise<LessonTypeListItem[]>,
        tRes.json() as Promise<TimeSlotListItem[]>,
      ]);
      return { ok: true as const, subjects, lessonTypes, timeSlots };
    },
    [authedFetch],
  );
}
