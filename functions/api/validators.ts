import { z } from 'zod';

type HexColor = string & { readonly __brand: 'HexColor' };

const classroomSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
});

const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'first name is required').max(100, 'first name must be 100 characters or less'),
    lastName: z.string().trim().min(1, 'last name is required').max(100, 'last name must be 100 characters or less'),
    classroomId: z.string().trim().optional(),
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

type CreateClassroomInput = z.infer<typeof classroomSchema>;
type CreateUserInput = {
  firstName: string;
  lastName: string;
  classroomId: string | null;
  color: HexColor;
  email: string;
  role: 'admin' | 'manager' | 'staff';
};

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
