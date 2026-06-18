/**
 * （責務）授業プリセット管理のコンテナ。科目/種別/枠の各ブロックを束ねる。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import LessonTypesBlock from '@/components/presets/LessonTypesBlock';
import SubjectsBlock from '@/components/presets/SubjectsBlock';
import TimeSlotsBlock from '@/components/presets/TimeSlotsBlock';
import {
  presetMutationNetworkError,
  readPresetApiError,
  toHm,
} from '@/components/presets/presetFormUtils';
import { FormErrorAlert } from '@/components/ui/form-error-alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthedFetch } from '@/hooks/useAuthedFetch';
import { useClassroomPresetsData } from '@/hooks/useClassroomPresetsData';
import type {
  ClassroomListItem,
  LessonTypeListItem,
  SubjectListItem,
  TimeSlotListItem,
} from '@/types/api';

import type { CurrentUser } from '../types/currentUser';

type SubjectRow = SubjectListItem;
type LessonTypeRow = LessonTypeListItem;
type TimeSlotRow = TimeSlotListItem;
type Classroom = ClassroomListItem;

type Props = {
  currentUser: CurrentUser;
  getAccessTokenSilently: () => Promise<string>;
};

/**
 * 管理者: 全教室のプリセット。教室長: 自教室のみ。
 * 科目・授業種別・時間枠の CRUD は `presets/*` 子コンポーネントに委譲。
 */
export default function PresetsSettingsPanel({
  currentUser,
  getAccessTokenSilently,
}: Props) {
  const isAdmin = currentUser.role === 'admin';

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>(
    currentUser.classroomId ?? '',
  );
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [lessonTypes, setLessonTypes] = useState<LessonTypeRow[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(false);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newSubjectName, setNewSubjectName] = useState('');
  const [newLessonTypeName, setNewLessonTypeName] = useState('');
  const [newSlotStart, setNewSlotStart] = useState('17:00');
  const [newSlotEnd, setNewSlotEnd] = useState('18:30');

  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftSlots, setDraftSlots] = useState<
    Record<string, { start: string; end: string }>
  >({});

  const activeClassroomId = useMemo(() => {
    return isAdmin ? selectedClassroomId : (currentUser.classroomId ?? '');
  }, [currentUser.classroomId, isAdmin, selectedClassroomId]);

  const activeClassroomIdRef = useRef(activeClassroomId);

  useEffect(() => {
    activeClassroomIdRef.current = activeClassroomId;
  }, [activeClassroomId]);

  const loadPresetsGen = useRef(0);
  const loadPresetsAbortRef = useRef<AbortController | null>(null);

  const authedFetch = useAuthedFetch(getAccessTokenSilently);
  const loadClassroomPresets = useClassroomPresetsData(authedFetch);

  const loadClassrooms = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setIsLoadingClassrooms(true);
    try {
      const res = await authedFetch('/api/classrooms');
      if (!res.ok) {
        setError('教室一覧の取得に失敗しました。');
        return;
      }
      const data = (await res.json()) as Classroom[];
      setClassrooms(data);
      setSelectedClassroomId((prev) => (prev ? prev : (data[0]?.id ?? '')));
    } catch {
      setError('教室一覧の取得に失敗しました。');
    } finally {
      setIsLoadingClassrooms(false);
    }
  }, [authedFetch, isAdmin]);

  const loadPresets = useCallback(async () => {
    loadPresetsAbortRef.current?.abort();
    const ac = new AbortController();
    loadPresetsAbortRef.current = ac;
    const gen = ++loadPresetsGen.current;

    const classroomAtStart = activeClassroomIdRef.current;
    if (!classroomAtStart) {
      setSubjects([]);
      setLessonTypes([]);
      setTimeSlots([]);
      setIsLoadingPresets(false);
      return;
    }

    setIsLoadingPresets(true);
    setError(null);
    try {
      const result = await loadClassroomPresets(classroomAtStart, ac.signal);
      if (
        gen !== loadPresetsGen.current ||
        activeClassroomIdRef.current !== classroomAtStart
      ) {
        return;
      }
      if (!result.ok) {
        setError('プリセット一覧の取得に失敗しました。');
        return;
      }
      setSubjects(result.subjects);
      setLessonTypes(result.lessonTypes);
      setTimeSlots(result.timeSlots);
      setDraftNames({});
      setDraftSlots({});
    } catch (e) {
      if (gen !== loadPresetsGen.current || ac.signal.aborted) {
        return;
      }
      setError(
        presetMutationNetworkError('プリセット一覧の取得に失敗しました', e),
      );
    } finally {
      if (gen === loadPresetsGen.current) {
        setIsLoadingPresets(false);
      }
    }
  }, [loadClassroomPresets, activeClassroomIdRef]);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubjectName.trim();
    if (!name || !activeClassroomId) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch('/api/subjects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, classroomId: activeClassroomId }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '科目の追加に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      setNewSubjectName('');
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('科目の追加に失敗しました', e));
    }
  };

  const handleAddLessonType = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newLessonTypeName.trim();
    if (!name || !activeClassroomId) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch('/api/lesson-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, classroomId: activeClassroomId }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '授業種別の追加に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      setNewLessonTypeName('');
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('授業種別の追加に失敗しました', e));
    }
  };

  const handleAddTimeSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClassroomId) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch('/api/time-slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId: activeClassroomId,
          startTime: toHm(newSlotStart),
          endTime: toHm(newSlotEnd),
        }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '時間枠の追加に失敗しました',
            invalidRequestHint: '時間枠の入力を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('時間枠の追加に失敗しました', e));
    }
  };

  const patchSubject = async (id: string) => {
    const name = (draftNames[id] ?? '').trim();
    if (!name) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch(`/api/subjects/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '科目の更新に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('科目の更新に失敗しました', e));
    }
  };

  const patchLessonType = async (id: string) => {
    const name = (draftNames[id] ?? '').trim();
    if (!name) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch(`/api/lesson-types/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '授業種別の更新に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('授業種別の更新に失敗しました', e));
    }
  };

  const patchTimeSlot = async (id: string) => {
    const d = draftSlots[id];
    if (!d) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch(`/api/time-slots/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startTime: toHm(d.start),
          endTime: toHm(d.end),
        }),
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '時間枠の更新に失敗しました',
            invalidRequestHint: '時間枠の入力を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('時間枠の更新に失敗しました', e));
    }
  };

  const disableSubject = async (id: string) => {
    setError(null);
    try {
      const res = await authedFetch(`/api/subjects/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '科目の無効化に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('科目の無効化に失敗しました', e));
    }
  };

  const disableLessonType = async (id: string) => {
    setError(null);
    try {
      const res = await authedFetch(`/api/lesson-types/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '授業種別の無効化に失敗しました',
            invalidRequestHint: '入力内容を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('授業種別の無効化に失敗しました', e));
    }
  };

  const disableTimeSlot = async (id: string) => {
    setError(null);
    try {
      const res = await authedFetch(`/api/time-slots/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(
          await readPresetApiError(res, {
            fallback: '時間枠の無効化に失敗しました',
            invalidRequestHint: '時間枠の入力を確認してください。',
          }),
        );
        return;
      }
      await loadPresets();
    } catch (e) {
      setError(presetMutationNetworkError('時間枠の無効化に失敗しました', e));
    }
  };

  if (!isAdmin && !currentUser.classroomId) {
    return (
      <p className="text-muted-foreground text-sm">
        所属教室が割り当てられていないため、プリセットを設定できません。
      </p>
    );
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Presets
        </p>
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          授業プリセット
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          科目・授業種別・時間枠の選択肢を教室ごとに管理します。無効化した項目は一覧に表示されず、新規コマで選べなくなります。
        </p>
      </header>

      {isAdmin && (
        <div className="max-w-md space-y-2">
          <Label htmlFor="preset-classroom">対象教室</Label>
          <Select
            value={selectedClassroomId}
            onValueChange={setSelectedClassroomId}
            disabled={isLoadingClassrooms}
          >
            <SelectTrigger id="preset-classroom">
              <SelectValue placeholder="教室を選択" />
            </SelectTrigger>
            <SelectContent>
              {classrooms.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <FormErrorAlert message={error} />

      {!activeClassroomId ? (
        <p className="text-muted-foreground text-sm">
          教室を選択するとプリセットを編集できます。
        </p>
      ) : isLoadingPresets ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : (
        <div className="space-y-10">
          <SubjectsBlock
            subjects={subjects}
            newSubjectName={newSubjectName}
            onNewSubjectNameChange={setNewSubjectName}
            onAdd={handleAddSubject}
            draftNames={draftNames}
            setDraftNames={setDraftNames}
            onPatch={patchSubject}
            onDisable={disableSubject}
          />
          <LessonTypesBlock
            lessonTypes={lessonTypes}
            newLessonTypeName={newLessonTypeName}
            onNewLessonTypeNameChange={setNewLessonTypeName}
            onAdd={handleAddLessonType}
            draftNames={draftNames}
            setDraftNames={setDraftNames}
            onPatch={patchLessonType}
            onDisable={disableLessonType}
          />
          <TimeSlotsBlock
            timeSlots={timeSlots}
            newSlotStart={newSlotStart}
            newSlotEnd={newSlotEnd}
            onNewSlotStartChange={setNewSlotStart}
            onNewSlotEndChange={setNewSlotEnd}
            onAdd={handleAddTimeSlot}
            draftSlots={draftSlots}
            setDraftSlots={setDraftSlots}
            onPatch={patchTimeSlot}
            onDisable={disableTimeSlot}
          />
        </div>
      )}
    </section>
  );
}
