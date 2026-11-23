"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bot, Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KnowledgeService, type KnowledgeBase } from '@/lib/knowledgeService';
import { useTranslation } from "@/i18n/useTranslation";

/**
 * Knowledge-base Q&A now starts an Agent conversation. Keeping this page as a
 * small launcher prevents the legacy one-shot RAG generator from becoming a
 * second production path with different citation and scope semantics.
 */
export function RAGQueryInterface() {
  const router = useRouter();
  const t = useTranslation();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await KnowledgeService.initDb();
        const bases = await KnowledgeService.getAllKnowledgeBases();
        if (!cancelled) setKnowledgeBases(bases);
      } catch (error) {
        console.error('[KnowledgeQALauncher] 加载知识库失败:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openAgent = () => {
    const query = selectedKbId
      ? `?knowledgeBase=${encodeURIComponent(selectedKbId)}`
      : '';
    router.push(`/chat${query}`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <CardTitle>{t('knowledge.query.title')}</CardTitle>
        </div>
        <CardDescription>
          {t('knowledge.query.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Database className="w-4 h-4 text-slate-400 shrink-0" />
          <Select value={selectedKbId} onValueChange={setSelectedKbId} disabled={loading || knowledgeBases.length === 0}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={loading ? t('knowledge.detail.loading') : t('knowledge.query.optionalSelect')} />
            </SelectTrigger>
            <SelectContent>
              {knowledgeBases.map((kb) => (
                <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        <Button onClick={openAgent} className="gap-2">
          {t('knowledge.query.openAgent')}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
