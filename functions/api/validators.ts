/**
 * （責務）リクエスト body / クエリの zod 系バリデーション。各 POST/PATCH の入力検証。
 */
import { z } from 'zod';

type HexColor = string & { readonly __brand: 'HexColor' };

const classroomSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
});

const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'first name is required').max(100, 'first name must be 100 characters or less'),
    lastName: z.string().trim().min(1, 'last name is required').max(100, 'last name must be 100 characters or less'),
    classroomId: z.string().trim().nullable().optional(),
    color: z
      .string()
      .trim()
      .min(1, 'color is required')
      .regex(/^#(?:[0-9a-fA-F]{6})$/, 'invalid color')
      .transform((value) => value as HexColor),
    email: z.string().trim().pipe(z.email('invalid email')),
    role: z.enum(['admin', 'manager', 'staff'], 'invalid role').default('staff'),
  })
  .superRefine((value, ctx) => {
    if (value.role !== 'admin' && !value.classroomId) {
      ctx.addIssue({
        code: 'custom',
        path: ['classroomId'],
        message: 'classroom id is required for non-admin user',
      });
    }
  });

const studentSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
    email: z.string().trim().pipe(z.email('invalid email')),
    birthYear: z.coerce
      .number()
      .int('birth year must be an integer')
      .min(1900, 'birth year is out of range'),
    classroomId: z.string().trim().min(1, 'classroom id is required'),
  })
  .superRefine((data, ctx) => {
    const maxYear = new Date().getFullYear();
    if (data.birthYear > maxYear) {
      ctx.addIssue({
        code: 'custom',
        path: ['birthYear'],
        message: 'birth year is out of range',
      });
    }
  });

/** H:MM / HH:MM / …:SS を HH:mm に揃える。範囲外・不正形はクランプせずそのまま返し、後段の regex で弾く */
const HM_NORMALIZE_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function normalizeToHm24(raw: string): string {
  const trimmed = raw.trim();
  const match = HM_NORMALIZE_PATTERN.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  const h = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] !== undefined ? Number(match[3]) : 0;
  if (
    Number.isNaN(h) ||
    Number.isNaN(minute) ||
    Number.isNaN(second) ||
    h < 0 ||
    h > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return trimmed;
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `HH:mm` 24h（許容形だけ正規化し、範囲外は後段 regex で拒否） */
const hmTimeSchema = z
  .string()
  .transform(normalizeToHm24)
  .pipe(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid time format (use HH:mm)'));

function parseHmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

const presetNameBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
  classroomId: z.string().trim().min(1, 'classroom id is required'),
});

const createTimeSlotSchema = z
  .object({
    classroomId: z.string().trim().min(1, 'classroom id is required'),
    startTime: hmTimeSchema,
    endTime: hmTimeSchema,
  })
  .superRefine((v, ctx) => {
    if (parseHmToMinutes(v.startTime) >= parseHmToMinutes(v.endTime)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'end time must be after start time',
      });
    }
  });

const patchSubjectSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
});

const patchLessonTypeSchema = patchSubjectSchema;

const patchTimeSlotSchema = z
  .object({
    startTime: hmTimeSchema.optional(),
    endTime: hmTimeSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startTime === undefined && v.endTime === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTime'],
        message: 'at least one of startTime or endTime is required',
      });
    }
  })
  .superRefine((v, ctx) => {
    if (v.startTime !== undefined && v.endTime !== undefined) {
      if (parseHmToMinutes(v.startTime) >= parseHmToMinutes(v.endTime)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endTime'],
          message: 'end time must be after start time',
        });
      }
    }
  });

type CreateClassroomInput = z.infer<typeof classroomSchema>;
type CreateUserInput = {
  firstName: string;
  lastName: string;
  classroomId: string | null;
  color: HexColor;
  email: string;
  role: 'admin' | 'manager' | 'staff';
};
type CreateStudentInput = z.infer<typeof studentSchema>;
type CreatePresetNameInput = z.infer<typeof presetNameBodySchema>;
type CreateTimeSlotInput = z.infer<typeof createTimeSlotSchema>;
type PatchSubjectInput = z.infer<typeof patchSubjectSchema>;
type PatchLessonTypeInput = z.infer<typeof patchLessonTypeSchema>;
type PatchTimeSlotInput = z.infer<typeof patchTimeSlotSchema>;

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'invalid request';
}

export function validateCreateClassroomInput(
  body: unknown,
): { input?: CreateClassroomInput; error?: string } {
  const result = classroomSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validateCreateUserInput(
  body: unknown,
): { input?: CreateUserInput; error?: string } {
  const result = userSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }

  return {
    input: {
      firstName: result.data.firstName,
      lastName: result.data.lastName,
      classroomId: result.data.role === 'admin' ? null : (result.data.classroomId ?? null),
      color: result.data.color,
      email: result.data.email,
      role: result.data.role,
    },
  };
}

export function validateCreateStudentInput(
  body: unknown,
): { input?: CreateStudentInput; error?: string } {
  const result = studentSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validateCreateSubjectInput(
  body: unknown,
): { input?: CreatePresetNameInput; error?: string } {
  const result = presetNameBodySchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validateCreateLessonTypeInput(
  body: unknown,
): { input?: CreatePresetNameInput; error?: string } {
  return validateCreateSubjectInput(body);
}

export function validateCreateTimeSlotInput(
  body: unknown,
): { input?: CreateTimeSlotInput; error?: string } {
  const result = createTimeSlotSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validatePatchSubjectInput(
  body: unknown,
): { input?: PatchSubjectInput; error?: string } {
  const result = patchSubjectSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validatePatchLessonTypeInput(
  body: unknown,
): { input?: PatchLessonTypeInput; error?: string } {
  const result = patchLessonTypeSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validatePatchTimeSlotInput(
  body: unknown,
): { input?: PatchTimeSlotInput; error?: string } {
  const result = patchTimeSlotSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

const lessonInstantSchema = z
  .union([z.string(), z.number(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'invalid date' });

const lessonStatusSchema = z.enum(['draft', 'published', 'completed']);

const createLessonSchema = z
  .object({
    teacherId: z.string().trim().min(1, 'teacher id is required'),
    studentId: z.string().trim().min(1, 'student id is required'),
    classroomId: z.string().trim().min(1, 'classroom id is required'),
    subjectId: z.string().trim().min(1).optional(),
    lessonTypeId: z.string().trim().min(1).optional(),
    startAt: lessonInstantSchema,
    endAt: lessonInstantSchema,
    status: lessonStatusSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startAt.getTime() >= data.endAt.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'end must be after start',
      });
    }
  });

const patchLessonSchema = z
  .object({
    teacherId: z.string().trim().min(1).optional(),
    studentId: z.string().trim().min(1).optional(),
    classroomId: z.string().trim().min(1).optional(),
    subjectId: z.string().trim().min(1).nullable().optional(),
    lessonTypeId: z.string().trim().min(1).nullable().optional(),
    startAt: lessonInstantSchema.optional(),
    endAt: lessonInstantSchema.optional(),
    status: lessonStatusSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const hasField =
      data.teacherId !== undefined ||
      data.studentId !== undefined ||
      data.classroomId !== undefined ||
      data.subjectId !== undefined ||
      data.lessonTypeId !== undefined ||
      data.startAt !== undefined ||
      data.endAt !== undefined ||
      data.status !== undefined;
    if (!hasField) {
      ctx.addIssue({
        code: 'custom',
        path: ['teacherId'],
        message: 'at least one field is required',
      });
    }
    if (data.startAt !== undefined && data.endAt !== undefined) {
      if (data.startAt.getTime() >= data.endAt.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['endAt'],
          message: 'end must be after start',
        });
      }
    }
  });

type CreateLessonInput = z.infer<typeof createLessonSchema>;
type PatchLessonInput = z.infer<typeof patchLessonSchema>;

export function validateCreateLessonInput(
  body: unknown,
): { input?: CreateLessonInput; error?: string } {
  const result = createLessonSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validatePatchLessonInput(
  body: unknown,
): { input?: PatchLessonInput; error?: string } {
  const result = patchLessonSchema.safeParse(body);
  if (!result.success) {
    return { error: firstIssueMessage(result.error) };
  }
  return { input: result.data };
}

export function validateLessonRangeQuery(query: {
  from?: string;
  to?: string;
}): { from?: Date; to?: Date; error?: string } {
  const fromRaw = query.from;
  const toRaw = query.to;
  if (!fromRaw?.trim() || !toRaw?.trim()) {
    return { error: 'from and to query parameters are required' };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: 'invalid from or to date' };
  }
  if (from.getTime() >= to.getTime()) {
    return { error: 'from must be before to' };
  }
  return { from, to };
}
