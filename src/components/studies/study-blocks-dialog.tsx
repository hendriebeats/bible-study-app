"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  getStudyTemplateBlocksDoc,
  saveStudyTemplateBlocksDoc,
} from "@/app/studies/actions";
import { BlockListEditor } from "@/components/studies/block-list-editor";
import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type BlockDraft,
  blockDraftsFromDoc,
  blockSpecFromDraft,
  blocksDocFromSpecs,
} from "@/lib/editor/blocks";
import { nodes } from "@/lib/editor/schema";
import { docToJSON, jsonToDoc } from "@/lib/editor/serialize";
import { cn } from "@/lib/utils";

type Tab = "section" | "template";

/** A draft list's persisted shape, for change detection (ignores the row keys). */
function specsJson(drafts: BlockDraft[]): string {
  return JSON.stringify(drafts.map(blockSpecFromDraft));
}

/**
 * The study-blocks editor popup, reached from a button atop the blocks area.
 * Two tabs — "This section" edits the live section blocks doc; "Template" edits
 * the study's per-study template (which seeds new sections, and for a template
 * study propagates to studies created from it). All four fields per block, plus
 * add / remove / reorder. Changes apply on Save: the section tab dispatches one
 * transaction to the live editor (persisted/broadcast/undoable); the template
 * tab writes the doc via a server action.
 */
export function StudyBlocksDialog({
  studyId,
  isTemplate,
}: {
  studyId: string;
  isTemplate: boolean;
}) {
  const editor = useEditorContext();
  // The context value's identity changes on every selection/edit; keep a ref so
  // the open-effect doesn't re-run (and clobber edits) while the dialog is open.
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("section");
  const [sectionDrafts, setSectionDraftsState] = useState<BlockDraft[]>([]);
  const [templateDrafts, setTemplateDraftsState] = useState<BlockDraft[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Refs mirror the draft state so Save can read the latest synchronously after
  // flushing a focused body editor (whose change commits on blur).
  const sectionRef = useRef<BlockDraft[]>([]);
  const templateRef = useRef<BlockDraft[]>([]);
  const sectionBaseline = useRef("");
  const templateBaseline = useRef("");

  function setSectionDrafts(next: BlockDraft[]) {
    sectionRef.current = next;
    setSectionDraftsState(next);
  }
  function setTemplateDrafts(next: BlockDraft[]) {
    templateRef.current = next;
    setTemplateDraftsState(next);
  }

  // On open: snapshot the section's blocks from the live editor, and fetch the
  // study's template. Re-runs only on open (editor read via the ref).
  useEffect(() => {
    if (!open) {
      return;
    }
    const view = editorRef.current?.getBlocksView() ?? null;
    const drafts = view ? blockDraftsFromDoc(docToJSON(view.state.doc)) : [];
    setSectionDrafts(drafts);
    sectionBaseline.current = specsJson(drafts);
    setTab("section");

    setTemplateLoading(true);
    let cancelled = false;
    getStudyTemplateBlocksDoc(studyId)
      .then((doc) => {
        if (cancelled) {
          return;
        }
        const td = blockDraftsFromDoc(doc);
        setTemplateDrafts(td);
        templateBaseline.current = specsJson(td);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Couldn't load the study's template.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTemplateLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, studyId]);

  /** Apply the section drafts to the live blocks editor as one transaction. */
  function applySectionDrafts(drafts: BlockDraft[]) {
    const view = editorRef.current?.getBlocksView();
    if (!view) {
      return;
    }
    const { doc } = view.state;
    const firstChild = doc.firstChild;
    const hasNotesIndex = firstChild?.type === nodes.notesIndex;
    // Keep the pinned notes index (the first child when present) untouched.
    const from =
      firstChild?.type === nodes.notesIndex ? firstChild.nodeSize : 0;
    const to = doc.content.size;
    const specs = drafts.map(blockSpecFromDraft);
    const tr = view.state.tr;
    if (specs.length > 0) {
      // The study_block nodes (blocksDocFromSpecs wraps them in a doc).
      tr.replaceWith(from, to, jsonToDoc(blocksDocFromSpecs(specs)).content);
    } else if (hasNotesIndex) {
      // No blocks left, but keep the pinned notes index (a valid lone block).
      tr.delete(from, to);
    } else {
      // Empty: fall back to the lone placeholder paragraph (shows empty state).
      tr.replaceWith(0, doc.content.size, nodes.paragraph.create());
    }
    tr.setMeta("allowVerseEdit", true);
    if (tr.docChanged) {
      view.dispatch(tr);
      view.focus();
    }
  }

  async function handleSave() {
    // Flush a focused body editor so its content lands in the refs (it commits
    // on blur). Blur is synchronous, so the refs are current right after.
    (document.activeElement as HTMLElement | null)?.blur();
    await Promise.resolve();

    const sectionChanged =
      specsJson(sectionRef.current) !== sectionBaseline.current;
    const templateChanged =
      specsJson(templateRef.current) !== templateBaseline.current;
    if (!sectionChanged && !templateChanged) {
      setOpen(false);
      return;
    }

    setSaving(true);
    try {
      if (sectionChanged) {
        applySectionDrafts(sectionRef.current);
      }
      if (templateChanged) {
        const doc = blocksDocFromSpecs(
          templateRef.current.map(blockSpecFromDraft),
        );
        await saveStudyTemplateBlocksDoc(studyId, doc);
      }
      setOpen(false);
      toast.success("Study blocks updated.");
    } catch {
      toast.error("Couldn't save the study blocks.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <SlidersHorizontal className="size-4" />
          Edit blocks
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-screen w-full max-w-2xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Study blocks</DialogTitle>
          <DialogDescription>
            {tab === "template" && isTemplate
              ? "These are the default blocks for studies created from this template."
              : tab === "template"
                ? "Your study's default blocks — used to seed new sections."
                : "The blocks in this section. Edit titles, subtitles, placeholders, and body content."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["section", "This section"],
              ["template", isTemplate ? "Template default" : "Template"],
            ] as const
          ).map(([value, labelText]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
              }}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-sm font-medium transition-colors",
                tab === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {labelText}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "section" ? (
            <BlockListEditor
              blocks={sectionDrafts}
              onChange={setSectionDrafts}
            />
          ) : templateLoading ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Loading template…
            </p>
          ) : (
            <BlockListEditor
              blocks={templateDrafts}
              onChange={setTemplateDrafts}
            />
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
