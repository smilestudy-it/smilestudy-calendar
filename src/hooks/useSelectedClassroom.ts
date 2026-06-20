import { useContext } from 'react';

import { SelectedClassroomContext } from '@/components/AppShell';

export function useSelectedClassroom() {
  const context = useContext(SelectedClassroomContext);
  if (!context) {
    throw new Error('useSelectedClassroom must be used within AppShell');
  }
  return context;
}
