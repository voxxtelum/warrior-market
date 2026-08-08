import { useEffect, useState } from "react";
import { marked } from "marked";
import { Layout } from "../components/Layout";
import { getFaq } from "../api";

export function FaqPage() {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    getFaq().then((md) => setHtml(marked.parse(md, { async: false })));
  }, []);

  return (
    <Layout title="FAQ" subtitle="Don't ask me">
      <div className="card faq-content" dangerouslySetInnerHTML={{ __html: html ?? "" }} />
    </Layout>
  );
}
