import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FontFamily, TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { FontSize } from "./fontSizeExtension";
import { FontWeight } from "./fontWeightExtension";
import { uploadNotificationImage } from "../../api";

const FONT_SIZES = [
  { label: "Small", value: "0.85rem" },
  { label: "Large", value: "1.25rem" },
  { label: "X-Large", value: "1.75rem" },
];

const FONT_WEIGHTS = [
  { label: "Light", value: "300" },
  { label: "Normal", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
  { label: "Bold", value: "700" },
  { label: "Extrabold", value: "800" },
];

// IBM Plex Sans is the app's default (loaded sitewide in index.html) - Plex
// Serif is loaded alongside it there too, so both render correctly both here
// and in the actual popup (dangerouslySetInnerHTML just carries the inline
// font-family style through).
const FONT_FAMILIES = [{ label: "IBM Plex Serif", value: "'IBM Plex Serif', serif" }];

const COLORS = [
  "#ffffff",
  "#111111",
  "#ef4444",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ content, onChange }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      FontSize,
      FontWeight,
      FontFamily,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Tiptap only reads its `content` prop on mount - resync when the parent
  // swaps in different content out from under an already-mounted editor
  // (e.g. NotificationForm switching from "New" to editing an existing row).
  useEffect(() => {
    if (!editor) return;
    if (content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, content]);

  const handleImagePick = useCallback(
    async (file: File) => {
      if (!editor) return;
      try {
        const { url } = await uploadNotificationImage(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to upload image");
      }
    },
    [editor],
  );

  if (!editor) return null;

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar">
        <button
          type="button"
          className={editor.isActive("bold") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={editor.isActive("italic") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={editor.isActive("strike") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </button>
        <select
          value={
            editor.isActive("heading", { level: 1 })
              ? "1"
              : editor.isActive("heading", { level: 2 })
                ? "2"
                : editor.isActive("heading", { level: 3 })
                  ? "3"
                  : "0"
          }
          onChange={(e) => {
            const level = Number(e.target.value);
            if (level === 0) editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
          }}
        >
          <option value="0">Paragraph</option>
          <option value="1">Heading</option>
          <option value="2">Subheading</option>
          <option value="3">Small heading</option>
        </select>
        <select
          value=""
          onChange={(e) => {
            const size = e.target.value;
            editor
              .chain()
              .focus()
              .setMark("textStyle", { fontSize: size || null })
              .run();
            e.target.value = "";
          }}
        >
          <option value="">Size...</option>
          {FONT_SIZES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
          <option value="">Normal</option>
        </select>
        <select
          value=""
          onChange={(e) => {
            const weight = e.target.value;
            editor
              .chain()
              .focus()
              .setMark("textStyle", { fontWeight: weight || null })
              .run();
            e.target.value = "";
          }}
        >
          <option value="">Weight...</option>
          {FONT_WEIGHTS.map((w) => (
            <option key={w.label} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => {
            const family = e.target.value;
            if (family) editor.chain().focus().setFontFamily(family).run();
            else editor.chain().focus().unsetFontFamily().run();
            e.target.value = "";
          }}
        >
          <option value="">Font...</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
          <option value="">Default</option>
        </select>
        <button type="button" onClick={() => editor.chain().focus().setTextAlign("left").run()} aria-label="Align left">
          ⇤
        </button>
        <button type="button" onClick={() => editor.chain().focus().setTextAlign("center").run()} aria-label="Align center">
          ⇔
        </button>
        <button type="button" onClick={() => editor.chain().focus().setTextAlign("right").run()} aria-label="Align right">
          ⇥
        </button>
        <button
          type="button"
          className={editor.isActive("bulletList") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          type="button"
          className={editor.isActive("orderedList") ? "is-active" : ""}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </button>
        <span className="rich-text-colors">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="color-swatch"
              style={{ backgroundColor: c }}
              aria-label={`Text color ${c}`}
              onClick={() => editor.chain().focus().setColor(c).run()}
            />
          ))}
          <input
            type="color"
            className="color-picker"
            aria-label="Custom text color"
            defaultValue="#e6e6e6"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
          <button type="button" onClick={() => editor.chain().focus().unsetColor().run()}>
            Clear color
          </button>
        </span>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Insert image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImagePick(file);
            e.target.value = "";
          }}
        />
      </div>
      <EditorContent editor={editor} className="rich-text-content" />
    </div>
  );
}
