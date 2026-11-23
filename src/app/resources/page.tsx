"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FoldingLoader from '@/components/ui/FoldingLoader';
import { translate } from '@/i18n';
import { useLocaleStore } from '@/store/localeStore';

// 重定向到合并后的知识页面
export default function ResourcesPage() {
  const router = useRouter();
  const locale = useLocaleStore((state) => state.locale);

  useEffect(() => {
    router.replace('/knowledge?tab=resources');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <FoldingLoader size={36} />
      <span role="status" className="sr-only">{translate(locale, 'resources.loading')}</span>
    </div>
  );
}
