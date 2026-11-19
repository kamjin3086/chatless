import type { Citation } from './evidenceTypes';
import { generateId } from '@/lib/utils/id';
import { clearEvidenceRegistry, restoreEvidence } from './EvidenceRegistry';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { KnowledgeAdapter } from '@/lib/mcp/pipeline/adapters/KnowledgeAdapter';
import { ToolInvocation } from '@/lib/mcp/pipeline/ToolInvocation';

export type SourceRead =
  | { ok: true; text: string; nextCursor?: string }
  | { ok: false; code: string; message: string };
export type SourceReadMode = 'exact' | 'neighbors' | 'current' | 'more';

/** A user-opened source view uses the same scope, revision and cursor checks as
 * knowledge.read, but does not pretend to be an agent run or persist tool events.
 */
export class CitationSourceReader {
  private readonly runId = `citation_view_${generateId()}`;
  private readonly adapter = new KnowledgeAdapter({ persistDeliveries: false });
  private readonly originalId: string;
  private anchorId: string;
  private active = true;

  constructor(
    private readonly citation: Citation,
    private readonly conversationId: string,
  ) {
    this.originalId = citation.evidenceId || citation.id;
    this.anchorId = this.originalId;
    restoreEvidence(this.runId, [
      {
        id: this.originalId,
        documentId: citation.documentId,
        documentName: citation.documentName,
        documentPath: citation.documentPath,
        documentHash: citation.documentHash,
        sourceBlockIds: citation.sourceBlockIds || [],
        retrievalChunkId: citation.retrievalChunkId,
        range: citation.range,
        locator: citation.locator,
        quote: citation.quote,
        score: 0,
      },
    ]);
  }

  get hasExactLocation() {
    return Boolean(this.citation.range || this.citation.retrievalChunkId);
  }

  async read(mode: SourceReadMode, cursor?: string): Promise<SourceRead> {
    if (!this.active) throw new Error('Source view was closed');
    if (mode === 'more' && !cursor)
      return {
        ok: false,
        code: 'CURSOR_INVALID',
        message: '没有可继续读取的位置。',
      };
    const args =
      mode === 'current'
        ? { documentId: this.citation.documentId }
        : mode === 'more'
          ? { documentId: this.citation.documentId, cursor }
          : {
              evidenceId: mode === 'exact' ? this.originalId : this.anchorId,
              before: mode === 'exact' ? 0 : 1,
              after: mode === 'exact' ? 0 : 1,
            };
    const result: unknown = await this.adapter.execute(
      new ToolInvocation({
        assistantMessageId: this.runId,
        conversationId: this.conversationId,
        server: 'knowledge',
        tool: 'read',
        args: { ...args, limit: 8000 },
        provider: '',
        model: '',
        historyForLlm: [],
        originalUserContent: '',
      }),
    );
    if (!this.active) {
      clearEvidenceRegistry(this.runId);
      throw new Error('Source view was closed');
    }
    if (!result || typeof result !== 'object' || !('ok' in result))
      throw new Error('Invalid source response');
    if (!result.ok) {
      const code =
        'error' in result && typeof result.error === 'string'
          ? result.error
          : 'SOURCE_UNAVAILABLE';
      const message =
        code === 'CURSOR_INVALID'
          ? '来源已重建、更新或没有保存精确位置。引用快照不受影响，可改读当前版本。'
          : code === 'INDEX_NOT_READY'
            ? '当前文档尚未完成索引，请完成索引后重试。'
            : '当前会话无法读取此来源。请确认文档仍在已挂载的知识库或会话附件中。';
      return { ok: false, code, message };
    }
    if (
      mode === 'current' &&
      'evidenceId' in result &&
      typeof result.evidenceId === 'string'
    )
      this.anchorId = result.evidenceId;
    else if (mode === 'exact') this.anchorId = this.originalId;
    return {
      ok: true,
      text:
        'text' in result && typeof result.text === 'string' ? result.text : '',
      nextCursor:
        'nextCursor' in result && typeof result.nextCursor === 'string'
          ? result.nextCursor
          : undefined,
    };
  }

  async openCurrentFile(): Promise<boolean> {
    // Recheck scope at click time; the historical path alone grants no access.
    const anchor = this.anchorId;
    const checked = await this.read('current');
    this.anchorId = anchor;
    if (!checked.ok) throw new Error(checked.message);
    const rows = await DatabaseService.getInstance()
      .getDbManager()
      .select<{ file_path: string }>(
        'SELECT file_path FROM documents WHERE id = ?',
        [this.citation.documentId],
      );
    if (!this.active) return false;
    if (!rows[0]?.file_path) throw new Error('当前原文件已不存在。');
    const { FileOpener } = await import('@/lib/utils/fileOpener');
    if (!this.active) return false;
    return FileOpener.openFile(rows[0].file_path, this.citation.documentName);
  }

  dispose() {
    this.active = false;
    clearEvidenceRegistry(this.runId);
  }
}
