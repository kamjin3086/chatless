/**
 * Lint a draft issue reply against the mechanical half of the reply rules (#156 fallout, retro ⑧).
 *
 * The rules live in `docs/agents/maintenance.md` ("Replying to a reporter"). Most of them are
 * judgement - which of the four classes a reply is, whether a thank-you is deserved, whether a fact
 * was actually verified - and a human decides those. This checks the part that is not judgement:
 *
 *   - the draft opens with the disclosure blockquote;
 *   - at most three paragraphs;
 *   - no apology or gratitude padding, no exclamation marks;
 *   - no internal artefacts (fenced blocks, backticked paths or calls);
 *   - no request for the reporter to choose a direction.
 *
 * Usage: `node scripts/check-reply.mjs <file>` or pipe the draft on stdin.
 */
import fs from 'node:fs';

export const DISCLOSURE = {
  zh: '> AI生成，人工审核。',
  en: '> AI-generated, human-reviewed.',
};

const PADDING = /抱歉|不好意思|请多包涵|感谢反馈|谢谢反馈|非常感谢|十分感谢|辛苦你/;
const DECISION = /你觉得|你们觉得|你选|请你决定|哪一个方案|哪个方向|1\s*还是\s*3|用哪种|你想怎么/;
const EXCITEMENT = /[！!]/;
const FENCED = /```/;
const BACKTICKED_PATH = /`[^`\s]*(?:src|lib|scripts|docs)\/[^`]*`/;
const BACKTICKED_CALL = /`[A-Za-z_$][\w.]*\(\)`/;

/** Every finding, in the order a reader would hit them. */
export function checkReply(text) {
  const findings = [];
  const raw = String(text || '');
  const lines = raw.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim());
  const first = firstIndex >= 0 ? lines[firstIndex].trim() : '';

  if (first !== DISCLOSURE.zh && first !== DISCLOSURE.en) {
    findings.push(
      `the first line must be the disclosure blockquote - either "${DISCLOSURE.zh}" or "${DISCLOSURE.en}"`,
    );
  }

  const body = lines.slice(firstIndex + 1).join('\n');
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length > 3) {
    findings.push(
      `${paragraphs.length} paragraphs - the rule is three at most (confirmed, workaround, next)`,
    );
  }

  const padding = raw.match(PADDING);
  if (padding) {
    findings.push(
      `"${padding[0]}" is apology or gratitude padding - thank specifically where work was done, and never apologise`,
    );
  }

  const excitement = raw.match(EXCITEMENT);
  if (excitement) {
    findings.push(`"${excitement[0]}" - warm is not enthusiastic; no exclamation marks`);
  }

  if (FENCED.test(raw)) {
    findings.push('a fenced code block - the reporter gets the outcome, not the internals');
  }
  const path = raw.match(BACKTICKED_PATH);
  if (path) {
    findings.push(`\`${path[0]}\` names a source path - that belongs in the owner-facing record`);
  }
  const call = raw.match(BACKTICKED_CALL);
  if (call) {
    findings.push(`\`${call[0]}\` names an internal function - describe the behaviour instead`);
  }

  const decision = raw.match(DECISION);
  if (decision) {
    findings.push(
      `"${decision[0]}" asks the reporter to choose - decisions are the owner's, and the draft is theirs to approve`,
    );
  }

  return findings;
}

const isMain =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-reply.mjs');

if (isMain) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const findings = checkReply(text);
  for (const finding of findings) {
    process.stdout.write(`check-reply: ${finding}\n`);
  }
  process.exit(findings.length ? 1 : 0);
}
