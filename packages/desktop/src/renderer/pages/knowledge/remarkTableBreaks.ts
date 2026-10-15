/** Render the editor's table-cell line breaks without enabling arbitrary HTML. */
type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };
export default function remarkTableBreaks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type === 'html' && /^<br\s*\/?\s*>$/i.test(child.value ?? '')) return { type: 'break' };
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}
