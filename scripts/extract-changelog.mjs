import { readFile } from 'node:fs/promises';

// v0.8.2 is the last release whose changelog can use the original, single-language format.
const LAST_LEGACY_RELEASE_VERSION = '0.8.2';
const RELEASE_LOCALES = ['zh-CN', 'en-US'];
const LEGACY_FALLBACK = '本次更新包含问题修复、性能改进与体验优化。';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;

function parseVersion(version) {
  const match = SEMVER.exec(version);
  if (match?.[0] !== version || match[4]?.split('.').some((part) => /^0\d+$/.test(part))) return undefined;
  return match.slice(1, 4).map(BigInt);
}

function isManagedRelease(versionParts) {
  const legacyParts = parseVersion(LAST_LEGACY_RELEASE_VERSION);
  const difference = versionParts.findIndex((part, index) => part !== legacyParts[index]);
  // The cutoff is a stable version, so prereleases with the same core version are older.
  return difference !== -1 && versionParts[difference] > legacyParts[difference];
}

function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getArgValue(args, name, short) {
  const longIndex = args.indexOf(`--${name}`);
  if (longIndex !== -1) return args[longIndex + 1];
  if (short) {
    const shortIndex = args.indexOf(`-${short}`);
    if (shortIndex !== -1) return args[shortIndex + 1];
  }
  return undefined;
}

function extractLegacyChangelog(lines, version, fallback) {
  const escapedVersion = escapeRegex(version);
  const headerRegexes = [
    new RegExp(`^##\\s*\\[\\s*v?\\s*${escapedVersion}\\s*\\]`),
    new RegExp(`^##\\s*v?\\s*${escapedVersion}\\b`),
  ];
  const start = lines.findIndex((line) => headerRegexes.some((regex) => regex.test(line)));
  if (start === -1) return fallback;
  const end = lines.findIndex((line, index) => index > start && /^##\s*\[/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim() || fallback;
}

function scanChangelogHeadings(lines) {
  const releaseHeadings = [];
  const headings = new Set();
  let fence;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) {
        fence = undefined;
      }
      return;
    }
    if (marker && (marker[1][0] === '~' || !marker[2].includes('`'))) {
      fence = { marker: marker[1], index };
      return;
    }
    if (/^ {0,3}#{1,3}(?:[ \t]|$)/.test(line)) headings.add(index);
    const version = /^## \[([^\]]+)\](?:[ \t].*)?$/.exec(line)?.[1];
    if (version && parseVersion(version)) releaseHeadings.push({ version, index });
  });
  return { releaseHeadings, headings, fence };
}

function extractManagedChangelog(lines, version) {
  const { releaseHeadings, headings, fence } = scanChangelogHeadings(lines);
  const matches = releaseHeadings.filter((heading) => heading.version === version);
  if (matches.length === 0) throw new Error(`Missing release heading ## [${version}]`);
  if (matches.length > 1) throw new Error(`Duplicate release heading ## [${version}]`);
  const start = matches[0].index;
  const end = releaseHeadings.find((heading) => heading.index > start)?.index ?? lines.length;
  if (fence && fence.index > start && fence.index < end) throw new Error('Unclosed code fence in release notes');

  const sections = new Map();
  let currentLocale;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (headings.has(index) || RELEASE_LOCALES.some((locale) => line === `## ${locale}`)) {
      const locale = RELEASE_LOCALES.find((candidate) => line === `### ${candidate}`);
      if (!locale) throw new Error(`Unexpected heading: ${line}. Use ### zh-CN, ### en-US, and #### for subsections.`);
      if (sections.has(locale)) throw new Error(`Duplicate ### ${locale} section`);
      currentLocale = locale;
      sections.set(locale, []);
    } else if (currentLocale) {
      sections.get(currentLocale).push(line);
    } else if (line.trim()) {
      throw new Error('Release notes must begin with a locale heading');
    }
  }

  return RELEASE_LOCALES.map((locale) => {
    const notes = sections.get(locale)?.join('\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
    if (notes === undefined) throw new Error(`Missing ### ${locale} section`);
    const visibleNotes = notes.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!visibleNotes) throw new Error(`Empty ### ${locale} section`);
    if (visibleNotes.includes('<!--')) throw new Error(`Unclosed HTML comment in ### ${locale} section`);
    return `## ${locale}\n\n${notes}`;
  }).join('\n\n');
}

async function extractChangelog({ version, path, fallback, managed }) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (managed) throw error;
    return fallback;
  }
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return managed ? extractManagedChangelog(lines, version) : extractLegacyChangelog(lines, version, fallback);
}

async function renderTaggedRelease({ notes, managed, repository, version, tag }) {
  const parts = await Promise.all((managed ? RELEASE_LOCALES : ['zh-CN']).map(async (locale) => {
    const template = await readFile(new URL(`./release-notes/${locale}.md`, import.meta.url), 'utf8');
    return template.trimEnd().replace(/\{\{(REPOSITORY|VERSION|TAG)\}\}/g, (_, token) => ({
      REPOSITORY: repository,
      VERSION: version,
      TAG: tag,
    })[token]);
  }));
  const changelog = managed ? notes : `## 更新内容\n\n${notes}`;
  return [...parts, changelog].join('\n\n---\n\n');
}

function renderManualRelease({ notes, repository, version }) {
  const zhGuide = `https://github.com/${repository}/blob/main/INSTALLATION_INSTRUCTIONS.md`;
  const enGuide = `https://github.com/${repository}/blob/main/INSTALLATION_INSTRUCTIONS_EN.md`;
  return `# Chatless ${version}\n\n` +
    `请在 Assets 中下载适合您平台的安装包，并参阅[安装指南](${zhGuide})。\n\n` +
    `Download the installer for your platform from Assets below. See the [installation guide](${enGuide}) for instructions.\n\n` +
    `---\n\n${notes}`;
}

async function main() {
  const args = process.argv.slice(2);
  const input = process.env.VERSION || getArgValue(args, 'version', 'v') || '';
  const version = input.replace(/^v/i, '');
  const path = getArgValue(args, 'path', 'p') || 'CHANGELOG.md';
  const fallback = getArgValue(args, 'fallback', 'f') || LEGACY_FALLBACK;
  const format = getArgValue(args, 'format') || 'changelog';
  if (!['changelog', 'tag', 'manual'].includes(format)) throw new Error(`Unknown release notes format: ${format}`);

  if (!input && format === 'changelog') {
    process.stdout.write(`${fallback}\n`);
    return;
  }
  const versionParts = parseVersion(version);
  if (!versionParts || (format === 'manual' && version !== input)) throw new Error(`Invalid release version: ${input}`);
  const managed = isManagedRelease(versionParts);
  if (!managed && format === 'manual') {
    process.stdout.write(process.env.LEGACY_RELEASE_NOTES ?? '');
    return;
  }

  const notes = await extractChangelog({ version, path, fallback, managed });
  const repository = process.env.GITHUB_REPOSITORY;
  if (format !== 'changelog' && !repository) throw new Error('GITHUB_REPOSITORY is required to render release links');
  let body = notes;
  if (format === 'tag') body = await renderTaggedRelease({ notes, managed, repository, version, tag: `v${version}` });
  if (format === 'manual') body = renderManualRelease({ notes, repository, version });
  process.stdout.write(`${body}\n`);
}

main().catch((error) => {
  console.error(`Release notes for ${process.env.VERSION || getArgValue(process.argv.slice(2), 'version', 'v') || '(no version)'}: ${error.message}`);
  process.exitCode = 1;
});
