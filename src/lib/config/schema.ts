/**
 * 数据库 Schema 定义中心
 *
 * 该文件统一管理应用中所有SQLite数据库的表结构和索引定义。
 * 这样做的好处是：
 * 1. **关注点分离**：将数据结构定义与业务逻辑、开发工具分离。
 * 2. **单一来源**：所有需要引用数据库结构的代码都从这里导入，保证一致性。
 * 3. **易于维护**：修改或查看数据库结构时，只需关心这一个文件。
 */

/**
 * 数据库表结构定义
 * 使用 CREATE TABLE IF NOT EXISTS 保证幂等性
 */
export const DATABASE_SCHEMA = {
  conversations: `
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model_id TEXT NOT NULL,
      tool_mode TEXT DEFAULT 'chat',
      is_important BOOLEAN DEFAULT 0,
      is_favorite BOOLEAN DEFAULT 0
    )
  `,
  messages: `
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      model TEXT,
      document_reference TEXT,
      context_data TEXT,
      knowledge_base_reference TEXT,
      images TEXT,
      thinking_start_time INTEGER,
      thinking_duration INTEGER,
      segments TEXT,
      version_group_id TEXT,
      version_index INTEGER,
      citations TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `,
  knowledge_bases: `
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT 'database',
      is_encrypted BOOLEAN DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,
  documents: `
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      tags TEXT,
      folder_path TEXT,
      is_indexed BOOLEAN DEFAULT 0,
      file_hash TEXT,
      parser_version TEXT,
      chunk_schema_version TEXT,
      embedding_model TEXT,
      embedding_dimension INTEGER,
      embedding_fingerprint TEXT
    )
  `,
  knowledge_chunks: `
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      knowledge_base_id TEXT NOT NULL,
      document_id TEXT,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
    )
  `,
  doc_knowledge_mappings: `
    CREATE TABLE IF NOT EXISTS doc_knowledge_mappings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'indexed', 'failed')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      UNIQUE(document_id, knowledge_base_id)
    )
  `,
  source_blocks: `
    CREATE TABLE IF NOT EXISTS source_blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      block_type TEXT NOT NULL,
      text TEXT NOT NULL,
      page INTEGER,
      section_path TEXT,
      line_start INTEGER,
      line_end INTEGER,
      char_start INTEGER,
      char_end INTEGER,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
    )
  `,
  retrieval_chunks: `
    CREATE TABLE IF NOT EXISTS retrieval_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      source_start_block INTEGER NOT NULL,
      source_end_block INTEGER NOT NULL,
      source_text TEXT NOT NULL,
      search_text TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
    )
  `,
  retrieval_chunks_fts: `
    CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      search_text,
      tokenize = 'unicode61'
    )
  `,
  dev_schema_info: `
    CREATE TABLE IF NOT EXISTS dev_schema_info (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
};

/**
 * 数据库索引定义
 * 使用 CREATE INDEX IF NOT EXISTS 保证幂等性
 */
export const DATABASE_INDEXES = [
  // conversations表索引
  "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_conversations_model_id ON conversations(model_id)",
  "CREATE INDEX IF NOT EXISTS idx_conversations_is_important ON conversations(is_important)",
  "CREATE INDEX IF NOT EXISTS idx_conversations_is_favorite ON conversations(is_favorite)",

  // messages表索引
  "CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role)",
  "CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)",
  "CREATE INDEX IF NOT EXISTS idx_messages_version_group_id ON messages(version_group_id)",

  // documents表索引
  "CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type)",
  "CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_documents_is_indexed ON documents(is_indexed)",

  // knowledge_bases表索引
  "CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created_at ON knowledge_bases(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_knowledge_bases_is_encrypted ON knowledge_bases(is_encrypted)",

  // knowledge_chunks表索引
  "CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_knowledge_base_id ON knowledge_chunks(knowledge_base_id)",
  "CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id ON knowledge_chunks(document_id)",

  // doc_knowledge_mappings表索引
  "CREATE INDEX IF NOT EXISTS idx_doc_knowledge_mappings_document_id ON doc_knowledge_mappings(document_id)",
  "CREATE INDEX IF NOT EXISTS idx_doc_knowledge_mappings_knowledge_base_id ON doc_knowledge_mappings(knowledge_base_id)",
  "CREATE INDEX IF NOT EXISTS idx_doc_knowledge_mappings_status ON doc_knowledge_mappings(status)",
  "CREATE INDEX IF NOT EXISTS idx_source_blocks_doc ON source_blocks(document_id, knowledge_base_id, block_index)",
  "CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_kb ON retrieval_chunks(knowledge_base_id, document_id)",
];
