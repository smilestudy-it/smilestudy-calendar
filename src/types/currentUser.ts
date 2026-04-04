export type CurrentUser = {
  id: string;
  role: 'admin' | 'manager' | 'staff' | null;
  classroomId: string | null;
};
