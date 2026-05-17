/**
 * 型など
 */
export type User = {
  id: string;
  role: 'admin' | 'manager' | 'staff';
  classroomId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  color: string;
};