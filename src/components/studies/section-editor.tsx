"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { renameSection, saveSection } from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { Section } from "@/lib/db/types";
import type { PMDocJSON } from "@/lib/editor/types";

const AUTOSAVE_DELAY_MS = 1200;

type SaveStatus = "idle" | "saving" | "saved";

interface ToolbarItem {
  icon: LucideIcon;
  label: string;
  run: () => void;
  isActive?: () => boolean;
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return null;
  }

  const groups: ToolbarItem[][] = [
    [
      {
        icon: Bold,
        label: "Bold",
        run: () => editor.chain().focus().toggleBold().run(),
        isActive: () => editor.isActive("bold"),
      },
      {
        icon: Italic,
        label: "Italic",
        run: () => editor.chain().focus().toggleItalic().run(),
        isActive: () => editor.isActive("italic"),
      },
      {
        icon: Strikethrough,
        label: "Strikethrough",
        run: () => editor.chain().focus().toggleStrike().run(),
        isActive: () => editor.isActive("strike"),
      },
    ],
    [
      {
        icon: Heading1,
        label: "Heading 1",
        run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: () => editor.isActive("heading", { level: 1 }),
      },
      {
        icon: Heading2,
        label: "Heading 2",
        run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: () => editor.isActive("heading", { level: 2 }),
      },
      {
        icon: Heading3,
        label: "Heading 3",
        run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: () => editor.isActive("heading", { level: 3 }),
      },
    ],
    [
      {
        icon: List,
        label: "Bullet list",
        run: () => editor.chain().focus().toggleBulletList().run(),
        isActive: () => editor.isActive("bulletList"),
      },
      {
        icon: ListOrdered,
        label: "Numbered list",
        run: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: () => editor.isActive("orderedList"),
      },
      {
        icon: Quote,
        label: "Quote",
        run: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: () => editor.isActive("blockquote"),
      },
    ],
    [
      {
        icon: Undo,
        label: "Undo",
        run: () => editor.chain().focus().undo().run(),
      },
      {
        icon: Redo,
        label: "Redo",
        run: () => editor.chain().focus().redo().run(),
      },
    ],
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1">
      {groups.map((group, index) => (
        <div key={group[0]?.label ?? index} className="flex items-center gap-1">
          {index > 0 ? (
            <Separator orientation="vertical" className="mx-1 h-6" />
          ) : null}
          {group.map((item) => (
            <Button
              key={item.label}
              type="button"
              size="icon"
              variant={item.isActive?.() ? "secondary" : "ghost"}
              aria-label={item.label}
              onClick={item.run}
            >
              <item.icon className="size-4" />
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SectionEditor({ section }: { section: Section }) {
  const [title, setTitle] = useState(section.title);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start writing your study notes…",
      }),
    ],
    content: section.content,
    editorProps: {
      attributes: { class: "focus:outline-none" },
    },
    onUpdate: ({ editor: active }) => {
      const content = active.getJSON() as PMDocJSON;
      setStatus("saving");
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void saveSection(section.id, content)
          .then(() => {
            setStatus("saved");
          })
          .catch(() => {
            setStatus("idle");
          });
      }, AUTOSAVE_DELAY_MS);
    },
    onBlur: ({ editor: active }) => {
      // Persist immediately on blur so navigating away never loses edits.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      void saveSection(section.id, active.getJSON() as PMDocJSON)
        .then(() => {
          setStatus("saved");
        })
        .catch(() => {
          setStatus("idle");
        });
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  function handleTitleBlur() {
    const next = title.trim() || "Untitled section";
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

  const statusLabel =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-3">
        <Input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onBlur={handleTitleBlur}
          aria-label="Section title"
          className="h-auto border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      <Toolbar editor={editor} />
      <div className="mt-4 flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
