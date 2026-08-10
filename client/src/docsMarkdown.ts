import { Marked } from "marked";

// Slug used both by the heading-id renderer below and by StockConfigTab (to
// build links that land on a specific section) - keep the two in sync if
// this changes.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A scoped Marked instance (rather than the shared default export FaqPage
// uses) so this heading-id override doesn't leak into other markdown
// rendered elsewhere in the app. Shared between the admin Docs tab and the
// public Documentation page, which both render STOCKS.md.
export const docsMarked = new Marked();
docsMarked.use({
  renderer: {
    heading(token) {
      const html = this.parser.parseInline(token.tokens);
      const id = slugifyHeading(token.text);
      return `<h${token.depth} id="${id}">${html}</h${token.depth}>\n`;
    },
  },
});
