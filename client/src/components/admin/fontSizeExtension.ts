import { Extension } from "@tiptap/core";

// TextStyle ships with no attributes of its own - this registers `fontSize`
// as a global attribute on it (rendered as an inline `style`), the same
// pattern Tiptap's own docs use for extending TextStyle rather than pulling
// in a separate font-size package for one attribute.
export const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: { fontSize?: string | null }) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});
