export type SourceBlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'caption';

export interface SourceLocator {
  page?: number;
  sectionPath?: string[];
  lineStart?: number;
  lineEnd?: number;
  paragraphIndex?: number;
}

export interface SourceBlock {
  id: string;
  documentId: string;
  knowledgeBaseId?: string;
  blockIndex: number;
  type: SourceBlockType;
  text: string;
  page?: number;
  sectionPath?: string[];
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  documentId?: string;
  title: string;
  fileType: string;
  blocks: SourceBlock[];
  plainText: string;
  metadata: {
    filePath?: string;
    fileHash: string;
    parserVersion: string;
    createdAt?: string;
  };
}

export interface RetrievalChunk {
  id: string;
  documentId: string;
  knowledgeBaseId?: string;
  sourceStartBlock: number;
  sourceEndBlock: number;
  sourceText: string;
  searchText: string;
  embedding?: number[];
  metadata: {
    sectionPath?: string[];
    pageStart?: number;
    pageEnd?: number;
    documentName?: string;
    documentPath?: string;
    chunkIndex?: number;
    [key: string]: unknown;
  };
}

export interface Evidence {
  id: string;
  documentId: string;
  documentName: string;
  documentPath?: string;
  documentHash?: string;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  sourceBlockIds: string[];
  locator: SourceLocator;
  quote: string;
  score: number;
  retrievalChunkId?: string;
}

export interface Citation {
  id: string;
  n: number;
  evidenceId: string;
  documentId: string;
  documentName: string;
  documentPath?: string;
  documentHash?: string;
  locator: SourceLocator;
  quote: string;
  stale?: boolean;
}

export const EVIDENCE_TAG_RE = /\[\[(E\d+)\]\]/g;
