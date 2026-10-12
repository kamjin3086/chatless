import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOL_GROUPS } from '@/lib/mcp/nativeTools/toolRegistry';

/**
 * `user_fs` 和 `skills_fs` 都已经退役：模型看不到它们的工具，Settings 也不再管理
 * 它们各自的目录名单。这里把"退役"从注释变成可执行的约束——把这条路挖回来的人，
 * 会先在这里撞到一条解释为什么不该这么做的测试。
 */
describe('retired filesystem surfaces stay retired', () => {
  it('advertises no tool for the retired user_fs / skills_fs servers', () => {
    const advertisedServers = TOOL_GROUPS.flatMap((group) => group.tools.map(({ server }) => server));

    expect(advertisedServers).not.toContain('user_fs');
    expect(advertisedServers).not.toContain('skills_fs');
  });

  it('keeps plugin-fs confined to the app-owned roots', () => {
    const file = resolve(process.cwd(), 'src-tauri/capabilities/main.json');
    const capability = JSON.parse(readFileSync(file, 'utf8'));
    const scope = (capability.permissions as Array<string | { identifier?: string; allow?: unknown }>)
      .find((permission) => typeof permission === 'object' && permission?.identifier === 'fs:scope');

    // 少了这条断言，条目改名或整段删除会让上面的 every() 空对空地通过。
    expect(scope, 'main window must keep an explicit fs:scope').toBeTruthy();
    const paths = (scope as { allow: Array<{ path: string }> }).allow.map((entry) => entry.path);

    // 越过这两个根，plugin-fs 一律拒绝，所以任何仍走 plugin-fs 的旧工具都碰不到用户
    // 目录。真正的文件强制在 Rust 允许名单那一侧，不在这里。放宽这一段，等于给
    // 已退役的 TS 侧名单重新开后门。
    expect(paths.every((path) => path === '$APPDATA' || path === '$APPLOG'
      || path.startsWith('$APPDATA/') || path.startsWith('$APPLOG/'))).toBe(true);
  });
});
