/**
 * （責務）削除・無効化前の確認ダイアログ。教室・ユーザ・生徒・プリセット・コマで共通利用する。
 */
import type { ReactNode } from 'react';

import { FormErrorAlert } from '@/components/FormErrorAlert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: ReactNode;
  /** 確認実行後の失敗メッセージ。ダイアログを開いたまま表示する */
  error?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title = '削除の確認',
  description = 'この操作は取り消せません。本当に削除しますか？',
  error = null,
  confirmLabel = '削除する',
  cancelLabel = 'キャンセル',
  isConfirming = false,
  onConfirm,
}: Props) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isConfirming) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        overlayClassName="z-[60]"
        className="z-[60]"
        size="default"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {typeof description === 'string' ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          )}
          <FormErrorAlert message={error} />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isConfirming}
            onClick={() => void onConfirm()}
          >
            {isConfirming ? '処理中...' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
