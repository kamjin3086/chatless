"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FoldingLoader from '@/components/ui/FoldingLoader';

// 重定向到合并后的知识页面
export default function ResourcesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/knowledge?tab=resources');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <FoldingLoader size={36} />
    </div>
  );
}
