import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSkillIndex, skillIndexBlocks } from '../skillIndex';
import type { SkillIndexEntryView } from '../skillIndex';

/**
 * `skillIndex.ts` 值钱的地方是它纯：输入进来，文本出去，没有第三个世界。
 *
 * 这不是一句风格偏好。这条缝上原来躺着四条走不通的路，每条都是「顺手在这里读一下
 * store / 盘」换来的：读一次就多一次时机问题，而时机问题在 prompt 里表现为某个用户的
 * 清单和别人不一样，最难查。所以这里把「纯」变成断言——把 import 加回来的人会先撞到
 * 这条测试和这段解释，而不是在集成测试里发现索引变得不可预期。
 */
const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/lib/skills/skillIndex.ts'),
  'utf8',
);

// 上面的解释本身提到了 `SkillManager`，所以扫描的是去注释后的代码：这条测试管的是
// 真的 import 了什么，不是文件里提到了什么名字。
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /(^|[^:])\/\/.*$/gm,
  '$1',
);

/** 允许 import 的东西。加一条要在这里加，那一步就是让「读盘」重新变成一次决定。 */
const ALLOWED_IMPORTS = [
  '@/lib/mcp/prompt/composition', // 只为 PromptBlock 的类型
  './types',
  './invocation',
];

const FORBIDDEN = [
  'node:fs',
  '@tauri-apps',
  'SkillManager',
  'useSkillStore',
  'Date.now',
  'Math.random',
  'process.env',
  'localStorage',
];

describe('the skill index stays a pure module', () => {
  it('reads a real file, so a rename fails here rather than passing vacuously', () => {
    expect(SOURCE.length).toBeGreaterThan(500);
  });

  it('imports nothing but the prompt block type, the policy and its own types', () => {
    const sources = [...CODE.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(
        ALLOWED_IMPORTS,
        `skillIndex.ts must not import ${source}`,
      ).toContain(source);
    }
  });

  it('touches no filesystem, no store, no Tauri, no clock, no randomness', () => {
    for (const needle of FORBIDDEN) {
      expect(CODE, `skillIndex.ts reached for ${needle}`).not.toContain(needle);
    }
  });

  it('is synchronous, so a call cannot depend on when it happens', () => {
    expect(CODE).not.toMatch(/\basync\b/);
    expect(CODE).not.toMatch(/\bawait\b/);
    expect(CODE).not.toMatch(/\bPromise\b/);
  });

  it('returns the same bytes for the same input, twice over', () => {
    const entries: SkillIndexEntryView[] = [
      { id: 'b', name: 'B', description: 'Second skill.' },
      { id: 'a', name: 'A', description: 'First skill.' },
    ];
    const once = skillIndexBlocks(buildSkillIndex(entries));
    const twice = skillIndexBlocks(buildSkillIndex(entries));

    expect(twice).toEqual(once);
    // 排序也不许看 locale：两台机器同一份清单必须发出同一串字节。
    const shuffled = skillIndexBlocks(buildSkillIndex([...entries].reverse()));
    expect(shuffled).toEqual(once);
  });
});
