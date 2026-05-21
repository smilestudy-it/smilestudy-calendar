/**
 * （責務）教室ごとの科目の追加・行編集・無効化 UI。
 */
import type { SubjectListItem } from '@/types/api';

import PresetSection from './PresetSection';

type Props = {
  subjects: SubjectListItem[];
  newSubjectName: string;
  onNewSubjectNameChange: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  draftNames: Record<string, string>;
  setDraftNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onPatch: (id: string) => void;
  onDisable: (id: string) => void;
};

/**
 * 教室ごとの「科目」一覧: 追加フォーム + 行ごとの更新・無効化
 */
export default function SubjectsBlock({
  subjects,
  newSubjectName,
  onNewSubjectNameChange,
  onAdd,
  draftNames,
  setDraftNames,
  onPatch,
  onDisable,
}: Props) {
  return (
    <PresetSection title="科目">
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label
            htmlFor="new-subject"
            className="mb-1 block text-xs text-slate-500"
          >
            追加
          </label>
          <input
            id="new-subject"
            value={newSubjectName}
            onChange={(e) => onNewSubjectNameChange(e.target.value)}
            placeholder="例: 英語"
            maxLength={100}
            className="w-full rounded-lg border border-slate-200 bg-slate-200/80 px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/25 focus:outline-none"
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
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-row sm:items-center"
          >
            <input
              aria-label={`科目 ${row.name}`}
              value={draftNames[row.id] ?? row.name}
              onChange={(e) =>
                setDraftNames((prev) => ({ ...prev, [row.id]: e.target.value }))
              }
              maxLength={100}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-200/80 px-3 py-2 text-slate-900"
            />
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-300"
                onClick={() => void onPatch(row.id)}
              >
                更新
              </button>
              <button
                type="button"
                className="rounded-lg border border-rose-200/60 bg-rose-100/50 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100/60"
                onClick={() => void onDisable(row.id)}
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
  );
}
