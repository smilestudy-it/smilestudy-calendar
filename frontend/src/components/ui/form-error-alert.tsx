/**
 * （責務）フォーム・パネル共通のエラー表示。
 */
import { Alert, AlertDescription } from '@/components/ui/alert';

type Props = {
  message: string | null | undefined;
};

export function FormErrorAlert({ message }: Props) {
  if (!message) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
