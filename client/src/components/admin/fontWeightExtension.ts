import { Extension } from "@tiptap/core";

// Same pattern as fontSizeExtension.ts - registers `fontWeight` as a global
// attribute on TextStyle (rendered as an inline `style`), since StarterKit's
// Bold mark is only a binary toggle and can't express e.g. "medium" or
// "semibold".
export const FontWeight = Extension.create({
  name: "fontWeight",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontWeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontWeight || null,
            renderHTML: (attributes: { fontWeight?: string | null }) => {
              if (!attributes.fontWeight) return {};
              return { style: `font-weight: ${attributes.fontWeight}` };
            },
          },
        },
      },
    ];
  },
});
