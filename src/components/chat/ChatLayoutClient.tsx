"use client";

import { useEffect } from "react";
import { ChatLayout } from "@/components/layout/ChatLayout";
import { installAndroidLogRing } from "@/lib/android/androidLogRing";
import { isAndroidRuntime } from "@/lib/utils/runtimePlatform";

interface ChatLayoutClientProps {
  children: React.ReactNode;
}

export default function ChatLayoutClient({ children }: ChatLayoutClientProps) {
  useEffect(() => {
    // Android 的 console 只进 logcat，手机不接 adb 就什么都看不到；这里先留一份内存副本，
    // 「管理模型」右下角的导出按钮才有东西可导。
    if (isAndroidRuntime()) installAndroidLogRing();
  }, []);

  return (
    <div className="w-full h-full overflow-hidden">
      <ChatLayout>{children}</ChatLayout>
    </div>
  );
}
