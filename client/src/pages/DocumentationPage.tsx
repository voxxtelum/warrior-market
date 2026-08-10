import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { getStocksDoc } from "../api";
import { docsMarked } from "../docsMarkdown";

export function DocumentationPage() {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    getStocksDoc()
      .then((md) => setHtml(docsMarked.parse(md, { async: false }) as string))
      .catch(() => setHtml("<p>Failed to load documentation.</p>"));
  }, []);

  return (
    <Layout
      title="Warrior Market"
      subtitle={
        <>
          Stocks for <s>Morons</s>&nbsp;
          <span className="accent-gold">&lt;Dawnfire&gt;</span> Warriors
        </>
      }
    >
      <div className="card docs-content" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
    </Layout>
  );
}
