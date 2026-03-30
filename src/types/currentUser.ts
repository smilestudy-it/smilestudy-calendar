export type CurrentUser = {
  role: 'admin' | 'manager' | 'staff' | null;
  classroomId: string | null;
};
