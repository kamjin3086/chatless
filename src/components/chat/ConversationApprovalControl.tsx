'use client';

import { useState } from 'react';
import { Shield, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useConversationAccessStore } from '@/store/conversationAccessStore';

export function ConversationApprovalControl({
  conversationId,
}: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const access = useConversationAccessStore(
    (state) => state.conversations[conversationId],
  );
  const automatic = access?.automatic ?? false;
  const hasGrants = Boolean(
    access &&
      (access.tools.length ||
        access.directories.length ||
        Object.keys(access.levels).length),
  );
  const label = automatic ? '全自动' : hasGrants ? '已授权' : '工具审批';

  return (
    <>
      <Button
        variant={automatic ? 'soft' : 'ghost'}
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`本会话工具审批：${automatic ? '全自动' : hasGrants ? '有临时授权' : '按设置确认'}`}
        title={`本会话工具审批：${automatic ? '全自动' : hasGrants ? '有临时授权' : '按设置确认'}`}
        className={
          automatic
            ? 'gap-1 px-2 text-xs text-amber-700 dark:text-amber-300'
            : 'gap-1 px-2 text-xs text-muted-foreground'
        }
      >
        {automatic ? (
          <ShieldCheck className="size-4" />
        ) : (
          <Shield className="size-4" />
        )}
        <span className={automatic ? undefined : 'hidden sm:inline'}>
          {label}
        </span>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>本会话工具审批</AlertDialogTitle>
            <AlertDialogDescription>
              {automatic
                ? '当前会话已开启全自动。关闭后，后续调用恢复原有审批规则；已开始的操作不会被撤回。'
                : '开启全自动后，已启用且在授权范围内的工具可直接运行，包括命令和外部 MCP 调用。新文件范围、删除和管理操作仍按原有权限规则检查。'}{' '}
              临时授权仅在当前会话有效，退出或重新加载应用后清除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>关闭</AlertDialogCancel>
            {(automatic || hasGrants) && (
              <AlertDialogAction
                onClick={() =>
                  useConversationAccessStore.getState().revoke(conversationId)
                }
              >
                关闭全自动并撤销临时授权
              </AlertDialogAction>
            )}
            {!automatic && (
              <AlertDialogAction
                onClick={() =>
                  useConversationAccessStore
                    .getState()
                    .setAutomatic(conversationId, true)
                }
              >
                开启本会话全自动
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
