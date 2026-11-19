import type { Citation } from '@/lib/rag/evidenceTypes';

type Node = {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  data?: { hName: string; hProperties: Record<string, string> };
};

/** Resolve both streaming segment markers and persisted numbered citations.
 * Walking Markdown text nodes keeps code samples and existing links intact.
 */
export function remarkCitations(citations: Citation[]) {
  const byNumber = new Map(citations.map((citation) => [citation.n, citation]));
  const byId = new Map(
    citations.map((citation) => [citation.evidenceId || citation.id, citation]),
  );
  return () => (tree: Node) => {
    function visit(node: Node) {
      if (
        !node.children ||
        node.type === 'link' ||
        node.type === 'linkReference'
      )
        return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return [child];
        }
        const result: Node[] = [];
        const text = child.value;
        let offset = 0;
        for (const match of text.matchAll(
          /\[\[(E\d+)\]\]|\[(E\d+)\]|\[(\d+)\]/g,
        )) {
          const index = match.index;
          const evidenceId = match[1] || match[2];
          const citation = evidenceId
            ? byId.get(evidenceId)
            : byNumber.get(Number(match[3]));
          if (!citation && !match[1]) continue;
          if (index > offset)
            result.push({ type: 'text', value: text.slice(offset, index) });
          if (citation)
            result.push({
              type: 'link',
              url: `#chatless-citation-${citation.n}`,
              data: {
                hName: 'span',
                hProperties: { 'data-chatless-citation': String(citation.n) },
              },
              children: [{ type: 'text', value: `[${citation.n}]` }],
            });
          offset = index + match[0].length;
        }
        if (!offset) return [child];
        if (offset < text.length)
          result.push({ type: 'text', value: text.slice(offset) });
        return result;
      });
    }
    visit(tree);
  };
}
