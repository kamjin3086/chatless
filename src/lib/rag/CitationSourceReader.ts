import type { Citation } from './evidenceTypes';
import type { Locale } from '@/i18n/types';
import { generateId } from '@/lib/utils/id';
import { clearEvidenceRegistry, restoreEvidence } from './EvidenceRegistry';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { KnowledgeAdapter } from '@/lib/mcp/pipeline/adapters/KnowledgeAdapter';
import { ToolInvocation } from '@/lib/mcp/pipeline/ToolInvocation';

type SourceFailure = { ok: false; code: string };
export type SourceRead =
  | { ok: true; text: string; nextCursor?: string }
  | SourceFailure;
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
      return { ok: false, code: 'NO_CONTINUATION' };
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
      return { ok: false, code };
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

  async openCurrentFile(locale: Locale): Promise<{ ok: true } | SourceFailure> {
    // Recheck scope at click time; the historical path alone grants no access.
    const anchor = this.anchorId;
    const checked = await this.read('current');
    this.anchorId = anchor;
    if (!checked.ok) return checked;
    const rows = await DatabaseService.getInstance()
      .getDbManager()
      .select<{ file_path: string }>(
        'SELECT file_path FROM documents WHERE id = ?',
        [this.citation.documentId],
      );
    if (!this.active) return { ok: false, code: 'FILE_OPEN_FAILED' };
    if (!rows[0]?.file_path) return { ok: false, code: 'FILE_MISSING' };
    const { FileOpener } = await import('@/lib/utils/fileOpener');
    const opened =
      this.active &&
      (await FileOpener.openFile(
        rows[0].file_path,
        this.citation.documentName,
        locale,
      ));
    return opened ? { ok: true } : { ok: false, code: 'FILE_OPEN_FAILED' };
  }

  dispose() {
    this.active = false;
    clearEvidenceRegistry(this.runId);
  }
}
