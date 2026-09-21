import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Drives a real SQLite file from the acceptance tests. The production query text
 * is executed verbatim by Python's sqlite3, which is the same engine the app
 * links, so scope filters, FTS ranking and result limits are the real ones.
 */
export class SqliteBridge {
  private process: ChildProcessWithoutNullStreams;
  private pending: Array<{ resolve: (value: QueryResult) => void; reject: (error: Error) => void }> = [];
  private lines: readline.Interface;

  constructor(databasePath: string) {
    const serverPath = path.join(__dirname, 'sqlite-query-server.py');
    this.process = spawn('python', [serverPath, databasePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.lines.on('line', (line) => {
      const waiter = this.pending.shift();
      if (!waiter) return;
      const payload = JSON.parse(line) as QueryResult & { error?: string };
      if (payload.error) waiter.reject(new Error(payload.error));
      else waiter.resolve(payload);
    });
    this.process.stderr.on('data', (chunk) => process.stderr.write(`[sqlite] ${String(chunk)}`));
    // A crashed helper must fail the caller instead of hanging the test.
    this.process.on('exit', (code) => {
      const pending = this.pending.splice(0, this.pending.length);
      for (const waiter of pending) waiter.reject(new Error(`sqlite helper exited with code ${code}`));
    });
  }

  query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    return new Promise<QueryResult>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ sql, params })}\n`);
    });
  }

  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query(sql, params);
    return result.rows as T[];
  }

  async close(): Promise<void> {
    this.lines.close();
    this.process.stdin.end();
    this.process.kill();
  }
}

export type QueryResult = { rows: Array<Record<string, unknown>>; ms: number };
