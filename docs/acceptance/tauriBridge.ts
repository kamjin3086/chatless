import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Runs the real Rust commands behind the real TypeScript adapters.
 *
 * The acceptance harness used to reimplement every tool in JavaScript, which is
 * why it could not see `shell__start` mangling a command line or
 * `read_shell_process` sending the wrong argument name. `cmd_bridge` loads the
 * same `chatless_lib` the desktop app does, so an acceptance run now executes
 * production code from the adapter down to the process it spawns.
 */
export class TauriBridge {
  private process: ChildProcessWithoutNullStreams;
  private lines: readline.Interface;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private stderrTail: string[] = [];

  constructor(private readonly dataDir: string) {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const binary = path.join(
      repoRoot,
      'src-tauri',
      'target',
      'debug',
      'examples',
      process.platform === 'win32' ? 'cmd_bridge.exe' : 'cmd_bridge',
    );
    if (!require('node:fs').existsSync(binary)) {
      execFileSync('cargo', ['build', '--example', 'cmd_bridge'], {
        cwd: path.join(repoRoot, 'src-tauri'),
        stdio: 'inherit',
      });
    }
    this.process = spawn(binary, [dataDir], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.lines.on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (chunk) => {
      this.stderrTail.push(String(chunk));
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    this.process.on('exit', (code) => {
      for (const [, waiter] of this.pending) {
        waiter.reject(new Error(`cmd_bridge exited with code ${code}: ${this.stderrTail.join('')}`));
      }
      this.pending.clear();
    });
  }

  private handleLine(line: string) {
    let payload: { id?: number; result?: unknown; error?: string };
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }
    const id = Number(payload.id);
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    if (payload.error) waiter.reject(new Error(payload.error));
    else waiter.resolve(payload.result);
  }

  /** The Tauri `invoke` surface, backed by the bridge process. */
  call = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const id = this.nextId++;
    const reply = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.process.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    return reply;
  };

  async close(): Promise<void> {
    this.lines.close();
    this.process.stdin.end();
    this.process.kill();
  }
}
