/**
 * （責務）未認証 GET/PUT /api/public/student-unavaliable-schedule の Vitest。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classrooms,
  student_unavailable_times,
  students,
  timeSlots,
} from '../db/schema';
import { app } from '../worker';

type StudentRow = {
  id: string;
  classroomId: string;
  name: string;
  deletedAt: Date | null;
};
type ClassroomRow = { id: string; deletedAt: Date | null };
type TimeSlotRow = {
  id: string;
  classroomId: string;
  startTime: string;
  endTime: string;
  deletedAt: Date | null;
};
type UnavailableRow = {
  id: string;
  studentId: string;
  classroomId: string;
  date: string;
  timeSlotId: string;
  deletedAt: Date | null;
};

const state: {
  studentRows: StudentRow[];
  classroomRows: ClassroomRow[];
  timeSlotRows: TimeSlotRow[];
  unavailableRows: UnavailableRow[];
} = {
  studentRows: [],
  classroomRows: [],
  timeSlotRows: [],
  unavailableRows: [],
};

let uuidSeq = 0;

vi.mock('../db', () => {
  const walkPredicate = (
    predicate: unknown,
  ): { strings: string[]; dates: Date[] } => {
    const strings: string[] = [];
    const dates: Date[] = [];
    const visited = new Set<object>();
    const stack: unknown[] = [predicate];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current instanceof Date) {
        dates.push(current);
        continue;
      }
      if (!current || typeof current !== 'object') {
        continue;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const v = (current as { value?: unknown }).value;
      if (typeof v === 'string') {
        strings.push(v);
      } else if (v instanceof Date) {
        dates.push(v);
      }
      for (const x of Object.values(current)) {
        stack.push(x);
      }
    }
    return { strings, dates };
  };

  const getDb = () => ({
    select: (sel: Record<string, unknown>) => {
      const keys = Object.keys(sel);

      return {
        from: (table: unknown) => {
          if (table === students && keys.includes('classroomId')) {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const { strings } = walkPredicate(predicate);
                  const id = strings.find((s) =>
                    state.studentRows.some((r) => r.id === s),
                  );
                  const row = state.studentRows.find(
                    (r) => r.id === id && r.deletedAt === null,
                  );
                  return row
                    ? [
                        {
                          id: row.id,
                          classroomId: row.classroomId,
                          name: row.name,
                        },
                      ]
                    : [];
                },
              }),
            };
          }

          if (table === classrooms && keys.length === 1 && keys[0] === 'id') {
            return {
              where: (predicate: unknown) => ({
                limit: async () => {
                  const { strings } = walkPredicate(predicate);
                  const id = strings.find((s) =>
                    state.classroomRows.some((r) => r.id === s),
                  );
                  const row = state.classroomRows.find(
                    (r) => r.id === id && r.deletedAt === null,
                  );
                  return row ? [{ id: row.id }] : [];
                },
              }),
            };
          }

          if (table === timeSlots && keys.length === 1 && keys[0] === 'id') {
            return {
              where: async (predicate: unknown) => {
                const { strings } = walkPredicate(predicate);
                return state.timeSlotRows
                  .filter(
                    (r) =>
                      r.deletedAt === null &&
                      strings.includes(r.classroomId) &&
                      strings.includes(r.id),
                  )
                  .map((r) => ({ id: r.id }));
              },
            };
          }

          if (table === student_unavailable_times) {
            return {
              where: async (predicate: unknown) => {
                const { strings } = walkPredicate(predicate);
                const dateKeys = strings.filter((s) =>
                  /^\d{4}-\d{2}-\d{2}$/.test(s),
                );
                return state.unavailableRows
                  .filter((r) => {
                    if (r.deletedAt !== null) {
                      return false;
                    }
                    if (!strings.includes(r.studentId)) {
                      return false;
                    }
                    if (dateKeys.length > 0 && !dateKeys.includes(r.date)) {
                      return false;
                    }
                    return true;
                  })
                  .map((r) => {
                    if (keys.includes('date')) {
                      return {
                        id: r.id,
                        date: r.date,
                        timeSlotId: r.timeSlotId,
                      };
                    }
                    return { id: r.id, timeSlotId: r.timeSlotId };
                  });
              },
            };
          }

          return {
            where: () => ({
              limit: async () => [],
            }),
          };
        },
      };
    },
    batch: async (queries: Promise<unknown>[]) => Promise.all(queries),
    insert: (table: unknown) => ({
      values: async (value: UnavailableRow | UnavailableRow[]) => {
        if (table !== student_unavailable_times) {
          return;
        }
        const rows = Array.isArray(value) ? value : [value];
        state.unavailableRows.push(...rows);
      },
    }),
    update: (table: unknown) => ({
      set: (value: { deletedAt?: Date | null }) => ({
        where: async (predicate: unknown) => {
          if (table !== student_unavailable_times) {
            return { meta: { changes: 0 } };
          }
          const { strings } = walkPredicate(predicate);
          let changes = 0;
          for (const row of state.unavailableRows) {
            if (strings.includes(row.id) && row.deletedAt === null) {
              if (value.deletedAt !== undefined) {
                row.deletedAt = value.deletedAt;
              }
              changes += 1;
            }
          }
          return { meta: { changes } };
        },
      }),
    }),
  });

  return { getDb };
});

const env = {
  AUTH0_AUDIENCE: 'https://api.example.local',
  AUTH0_ISSUER: 'https://issuer.example.local/',
  AUTH0_JWKS_URI: 'https://issuer.example.local/.well-known/jwks.json',
  VITE_AUTH0_DOMAIN: 'tenant.example.auth0.com',
  AUTH0_M2M_CLIENT_ID: 'm2m-client-id',
  AUTH0_M2M_CLIENT_SECRET: 'm2m-client-secret',
  AUTH0_DB_CONNECTION: 'Username-Password-Authentication',
  VITE_AUTH0_CLIENT_ID: 'spa-client-id',
  DB: {},
} as unknown as Env;

describe('/api/public/student-unavaliable-schedule', () => {
  beforeEach(() => {
    uuidSeq = 0;
    state.classroomRows = [{ id: 'room-1', deletedAt: null }];
    state.studentRows = [
      {
        id: 'stu-1',
        classroomId: 'room-1',
        name: '佐藤 花子',
        deletedAt: null,
      },
    ];
    state.timeSlotRows = [
      {
        id: 'ts-1',
        classroomId: 'room-1',
        startTime: '17:00',
        endTime: '18:30',
        deletedAt: null,
      },
      {
        id: 'ts-2',
        classroomId: 'room-1',
        startTime: '18:30',
        endTime: '20:00',
        deletedAt: null,
      },
    ];
    state.unavailableRows = [];
    vi.stubGlobal('crypto', {
      randomUUID: () => `uuid-${++uuidSeq}`,
    } as Crypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET returns 400 without student_id', async () => {
    const res = await app.request(
      '/api/public/student-unavaliable-schedule',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('GET returns 404 when student is missing', async () => {
    const res = await app.request(
      '/api/public/student-unavaliable-schedule?student_id=missing',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('GET returns empty list when student has no rows', async () => {
    const res = await app.request(
      '/api/public/student-unavaliable-schedule?student_id=stu-1',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      student_unavailable_schedule: unknown[];
    };
    expect(payload.student_unavailable_schedule).toEqual([]);
  });

  it('GET returns active rows only', async () => {
    state.unavailableRows = [
      {
        id: 'u-1',
        studentId: 'stu-1',
        classroomId: 'room-1',
        date: '2025-06-10',
        timeSlotId: 'ts-1',
        deletedAt: null,
      },
      {
        id: 'u-del',
        studentId: 'stu-1',
        classroomId: 'room-1',
        date: '2025-06-11',
        timeSlotId: 'ts-2',
        deletedAt: new Date(),
      },
      {
        id: 'u-other',
        studentId: 'stu-other',
        classroomId: 'room-1',
        date: '2025-06-10',
        timeSlotId: 'ts-1',
        deletedAt: null,
      },
    ];

    const res = await app.request(
      '/api/public/student-unavaliable-schedule?student_id=stu-1',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      student_unavailable_schedule: Array<{
        id: string;
        date: string;
        timeSlotId: string;
      }>;
    };
    expect(payload.student_unavailable_schedule).toEqual([
      { id: 'u-1', date: '2025-06-10', timeSlotId: 'ts-1' },
    ]);
  });

  it('PUT syncs slots for a date (insert)', async () => {
    const res = await app.request(
      '/api/public/student-unavaliable-schedule?student_id=stu-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2025-06-10',
          timeSlotIds: ['ts-1', 'ts-2'],
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      student_unavailable_schedule: Array<{
        id: string;
        date: string;
        timeSlotId: string;
      }>;
    };
    expect(payload.student_unavailable_schedule).toEqual([
      { id: 'uuid-1', date: '2025-06-10', timeSlotId: 'ts-1' },
      { id: 'uuid-2', date: '2025-06-10', timeSlotId: 'ts-2' },
    ]);
    expect(state.unavailableRows).toHaveLength(2);
  });

  it('PUT rejects invalid time slot id', async () => {
    const res = await app.request(
      '/api/public/student-unavaliable-schedule?student_id=stu-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2025-06-10',
          timeSlotIds: ['ts-missing'],
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { message: string };
    expect(payload.message).toBe('invalid time slot id');
  });

  it('PUT returns 404 when student is missing', async () => {
    const res = await app.request(
      '/api/public/student-unavaliable-schedule?student_id=missing',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2025-06-10',
          timeSlotIds: ['ts-1'],
        }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});
