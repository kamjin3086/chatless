"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bot, Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KnowledgeService, type KnowledgeBase } from '@/lib/knowledgeService';

/**
 * Knowledge-base Q&A now starts an Agent conversation. Keeping this page as a
 * small launcher prevents the legacy one-shot RAG generator from becoming a
 * second production path with different citation and scope semantics.
 */
export function RAGQueryInterface() {
  const router = useRouter();
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
          <CardTitle>使用 Agent 问答</CardTitle>
        </div>
        <CardDescription>
          Agent 会按需列出资料、检索原文并继续阅读长文档，回答中保留可核对引用。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Database className="w-4 h-4 text-slate-400 shrink-0" />
          <Select value={selectedKbId} onValueChange={setSelectedKbId} disabled={loading || knowledgeBases.length === 0}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={loading ? '正在加载知识库…' : '可选：先挂载一个知识库'} />
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
          打开 Agent 对话
          <ArrowRight className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
