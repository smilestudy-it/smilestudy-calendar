import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CurrentUser } from '../types/currentUser';

/** `<input type="time">` の値を API の `HH:mm` に揃える */
function toHm(v: string): string {
  const parts = v.trim().split(':');
  if (parts.length >= 2) {
    const h = parts[0]?.padStart(2, '0') ?? '00';
    const m = (parts[1] ?? '00').slice(0, 2).padStart(2, '0');
    return `${h}:${m}`;
  }
  return v.trim();
}

function presetMutationNetworkError(prefix: string, e: unknown): string {
  if (e instanceof Error) {
    return `${prefix}: ${e.message}`;
  }
  return 'ネットワークエラーが発生しました。';
}

async function readPresetApiError(
  res: Response,
  options: { fallback: string; invalidRequestHint: string },
): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (body.message === 'invalid request') {
    return options.invalidRequestHint;
  }
  if (body.message) {
    return `${options.fallback}（${body.message}）`;
  }
  return options.fallback;
}

type Classroom = { id: string; name: string };
type SubjectRow = { id: string; name: string };
type LessonTypeRow = { id: string; name: string };
type TimeSlotRow = { id: string; startTime: string; endTime: string };

type Props = {
  currentUser: CurrentUser;
  getAccessTokenSilently: () => Promise<string>;
};

export default function PresetsSettingsPanel({ currentUser, getAccessTokenSilently }: Props) {
  const isAdmin = currentUser.role === 'admin';

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>(currentUser.classroomId ?? '');
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
  const [draftSlots, setDraftSlots] = useState<Record<string, { start: string; end: string }>>({});

  const activeClassroomId = useMemo(() => {
    return isAdmin ? selectedClassroomId : (currentUser.classroomId ?? '');
  }, [currentUser.classroomId, isAdmin, selectedClassroomId]);

  const activeClassroomIdRef = useRef(activeClassroomId);
  activeClassroomIdRef.current = activeClassroomId;

  const loadPresetsGen = useRef(0);
  const loadPresetsAbortRef = useRef<AbortController | null>(null);

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessTokenSilently();
      return fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessTokenSilently],
  );

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
      const [sRes, lRes, tRes] = await Promise.all([
        authedFetch(`/api/classrooms/${classroomAtStart}/subjects`, { signal: ac.signal }),
        authedFetch(`/api/classrooms/${classroomAtStart}/lesson-types`, { signal: ac.signal }),
        authedFetch(`/api/classrooms/${classroomAtStart}/time-slots`, { signal: ac.signal }),
      ]);
      if (gen !== loadPresetsGen.current || activeClassroomIdRef.current !== classroomAtStart) {
        return;
      }
      if (!sRes.ok || !lRes.ok || !tRes.ok) {
        setError('プリセット一覧の取得に失敗しました。');
        return;
      }
      setSubjects((await sRes.json()) as SubjectRow[]);
      setLessonTypes((await lRes.json()) as LessonTypeRow[]);
      setTimeSlots((await tRes.json()) as TimeSlotRow[]);
      setDraftNames({});
      setDraftSlots({});
    } catch (e) {
      if (gen !== loadPresetsGen.current || ac.signal.aborted) {
        return;
      }
      setError(presetMutationNetworkError('プリセット一覧の取得に失敗しました', e));
    } finally {
      if (gen === loadPresetsGen.current) {
        setIsLoadingPresets(false);
      }
    }
  }, [authedFetch]);

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
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startTime: toHm(d.start), endTime: toHm(d.end) }),
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
      const res = await authedFetch(`/api/subjects/${id}`, { method: 'DELETE' });
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
      const res = await authedFetch(`/api/lesson-types/${id}`, { method: 'DELETE' });
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
      const res = await authedFetch(`/api/time-slots/${id}`, { method: 'DELETE' });
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
      <p className="text-sm text-slate-400">
        所属教室が割り当てられていないため、プリセットを設定できません。
      </p>
    );
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2 border-b border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400/90">Presets</p>
        <h2 className="text-xl font-bold tracking-tight text-slate-50 md:text-2xl">授業プリセット</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          科目・授業種別・時間枠の選択肢を教室ごとに管理します。無効化した項目は一覧に表示されず、新規コマで選べなくなります。
        </p>
      </header>

      {isAdmin && (
        <div className="max-w-md space-y-1">
          <label htmlFor="preset-classroom" className="text-sm text-slate-300">
            対象教室
          </label>
          <select
            id="preset-classroom"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
            value={selectedClassroomId}
            onChange={(e) => setSelectedClassroomId(e.target.value)}
            disabled={isLoadingClassrooms}
          >
            <option value="">教室を選択</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200" role="alert">
          {error}
        </p>
      )}

      {!activeClassroomId ? (
        <p className="text-sm text-slate-500">教室を選択するとプリセットを編集できます。</p>
      ) : isLoadingPresets ? (
        <p className="text-sm text-slate-400">読み込み中…</p>
      ) : (
        <div className="space-y-10">
          <PresetSection title="科目">
            <form onSubmit={handleAddSubject} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label htmlFor="new-subject" className="mb-1 block text-xs text-slate-400">
                  追加
                </label>
                <input
                  id="new-subject"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="例: 英語"
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
              >
                追加
              </button>
            </form>
            <ul className="mt-4 space-y-2">
              {subjects.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center"
                >
                  <input
                    aria-label={`科目 ${row.name}`}
                    value={draftNames[row.id] ?? row.name}
                    onChange={(e) => setDraftNames((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    maxLength={100}
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                  />
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                      onClick={() => void patchSubject(row.id)}
                    >
                      更新
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-900/60"
                      onClick={() => void disableSubject(row.id)}
                    >
                      無効化
                    </button>
                  </div>
                </li>
              ))}
              {subjects.length === 0 && (
                <li className="text-sm text-slate-500">科目がまだありません。</li>
              )}
            </ul>
          </PresetSection>

          <PresetSection title="授業種別">
            <form onSubmit={handleAddLessonType} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label htmlFor="new-lesson-type" className="mb-1 block text-xs text-slate-400">
                  追加
                </label>
                <input
                  id="new-lesson-type"
                  value={newLessonTypeName}
                  onChange={(e) => setNewLessonTypeName(e.target.value)}
                  placeholder="例: 通常"
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
              >
                追加
              </button>
            </form>
            <ul className="mt-4 space-y-2">
              {lessonTypes.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center"
                >
                  <input
                    aria-label={`授業種別 ${row.name}`}
                    value={draftNames[row.id] ?? row.name}
                    onChange={(e) => setDraftNames((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    maxLength={100}
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                  />
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                      onClick={() => void patchLessonType(row.id)}
                    >
                      更新
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-900/60"
                      onClick={() => void disableLessonType(row.id)}
                    >
                      無効化
                    </button>
                  </div>
                </li>
              ))}
              {lessonTypes.length === 0 && (
                <li className="text-sm text-slate-500">授業種別がまだありません。</li>
              )}
            </ul>
          </PresetSection>

          <PresetSection title="時間枠">
            <form onSubmit={handleAddTimeSlot} className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="new-slot-start" className="mb-1 block text-xs text-slate-400">
                  開始
                </label>
                <input
                  id="new-slot-start"
                  type="time"
                  value={newSlotStart}
                  onChange={(e) => setNewSlotStart(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="new-slot-end" className="mb-1 block text-xs text-slate-400">
                  終了
                </label>
                <input
                  id="new-slot-end"
                  type="time"
                  value={newSlotEnd}
                  onChange={(e) => setNewSlotEnd(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
              >
                追加
              </button>
            </form>
            <ul className="mt-4 space-y-2">
              {timeSlots.map((row) => {
                const d = draftSlots[row.id] ?? { start: row.startTime, end: row.endTime };
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-end"
                  >
                    <div className="flex flex-wrap gap-2">
                      <div>
                        <span className="mb-1 block text-xs text-slate-400">開始</span>
                        <input
                          type="time"
                          aria-label={`時間枠開始 ${row.id}`}
                          value={d.start}
                          onChange={(e) =>
                            setDraftSlots((prev) => ({
                              ...prev,
                              [row.id]: { ...d, start: e.target.value },
                            }))
                          }
                          className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                        />
                      </div>
                      <div>
                        <span className="mb-1 block text-xs text-slate-400">終了</span>
                        <input
                          type="time"
                          aria-label={`時間枠終了 ${row.id}`}
                          value={d.end}
                          onChange={(e) =>
                            setDraftSlots((prev) => ({
                              ...prev,
                              [row.id]: { ...d, end: e.target.value },
                            }))
                          }
                          className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-100"
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                        onClick={() => void patchTimeSlot(row.id)}
                      >
                        更新
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-900/60"
                        onClick={() => void disableTimeSlot(row.id)}
                      >
                        無効化
                      </button>
                    </div>
                  </li>
                );
              })}
              {timeSlots.length === 0 && (
                <li className="text-sm text-slate-500">時間枠がまだありません。</li>
              )}
            </ul>
          </PresetSection>
        </div>
      )}
    </section>
  );
}

function PresetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 md:p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-100">{title}</h3>
      {children}
    </section>
  );
}
