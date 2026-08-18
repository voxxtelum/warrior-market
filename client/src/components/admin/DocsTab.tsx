import { useEffect, useRef, useState } from "react";
import { getStocksDoc } from "../../api";
import { docsMarked } from "../../docsMarkdown";

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
    <section className="admin-section">
      <div ref={containerRef} className="docs-content" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
    </section>
  );
}
