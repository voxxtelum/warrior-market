import { useEffect, useRef, useState } from "react";
import { Marked } from "marked";
import { getStocksDoc } from "../../api";

// Slug used both here (to tag each rendered heading with an id) and by
// StockConfigTab (to build links that land on a specific section) - keep
// the two in sync if this changes.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A scoped Marked instance (rather than the shared default export FaqPage
// uses) so this heading-id override doesn't leak into other markdown
// rendered elsewhere in the app.
const docsMarked = new Marked();
docsMarked.use({
  renderer: {
    heading(token) {
      const html = this.parser.parseInline(token.tokens);
      const id = slugifyHeading(token.text);
      return `<h${token.depth} id="${id}">${html}</h${token.depth}>\n`;
    },
  },
});

export function DocsTab({ scrollToAnchor }: { scrollToAnchor: string | null }) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getStocksDoc()
      .then((md) => setHtml(docsMarked.parse(md, { async: false }) as string))
      .catch(() => setHtml("<p>Failed to load STOCKS.md.</p>"));
  }, []);

  // Runs whenever the content finishes loading, or the target anchor
  // changes (e.g. clicking a different "See docs" link while already on
  // this tab) - scrollIntoView needs the heading to actually be in the DOM.
  useEffect(() => {
    if (!html || !scrollToAnchor || !containerRef.current) return;
    const target = containerRef.current.querySelector(`#${CSS.escape(scrollToAnchor)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [html, scrollToAnchor]);

  return (
    <div className="card">
      <div ref={containerRef} className="docs-content" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
    </div>
  );
}
