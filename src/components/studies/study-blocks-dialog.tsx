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
import { EditorToolbar } from "@/components/studies/editor-toolbar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  type DialogItem,
  dialogItemsFromDoc,
  dialogItemsToDocContent,
} from "@/lib/editor/blocks";
import { docToJSON, jsonToDoc } from "@/lib/editor/serialize";
import { cn } from "@/lib/utils";

type Tab = "section" | "template";

/** Adapter: present a BlockDraft[] (template tab — no notes) as DialogItem[]
 * for the unified BlockListEditor signature. */
function draftsToItems(drafts: BlockDraft[]): DialogItem[] {
  return drafts.map((draft) => ({ kind: "study", key: draft.key, draft }));
}

/** Reverse adapter: collapse a DialogItem[] back to drafts (template tab —
 * silently drops any notes item, which the template tab never produces). */
function itemsToDrafts(items: DialogItem[]): BlockDraft[] {
  const out: BlockDraft[] = [];
  for (const item of items) {
    if (item.kind === "study") out.push(item.draft);
  }
  return out;
}

/** A draft list's persisted shape, for change detection (ignores the row keys). */
function draftsJson(drafts: BlockDraft[]): string {
  return JSON.stringify(drafts.map(blockSpecFromDraft));
}

/** Items list serialized for dirty-check (keys excluded; kind + per-kind
 * payload included). Stable shape — equality is the only consumer. */
function itemsJson(items: DialogItem[]): string {
  return JSON.stringify(
    items.map((item) =>
      item.kind === "study"
        ? { kind: "study", spec: blockSpecFromDraft(item.draft) }
        : { kind: "notes", content: item.content ?? [] },
    ),
  );
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
  const [sectionItems, setSectionItemsState] = useState<DialogItem[]>([]);
  const [templateDrafts, setTemplateDraftsState] = useState<BlockDraft[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Refs mirror the draft state so Save (and the dirty check) can read the
  // latest synchronously after flushing a focused body editor (whose change
  // commits on blur). Section state is the discriminated DialogItem[] so the
  // notes_index round-trips as a reorderable card; template state stays plain
  // BlockDraft[] since templates never carry a notes_index.
  const sectionRef = useRef<DialogItem[]>([]);
  const templateRef = useRef<BlockDraft[]>([]);
  const sectionBaseline = useRef("");
  const templateBaseline = useRef("");
  // Cancel button + the discard-confirm Accept skip the dirty check by flipping
  // this for one close cycle — the user has already chosen to discard.
  const bypassDirtyCheck = useRef(false);

  function setSectionItems(next: DialogItem[]) {
    sectionRef.current = next;
    setSectionItemsState(next);
  }
  function setTemplateDrafts(next: BlockDraft[]) {
    templateRef.current = next;
    setTemplateDraftsState(next);
  }

  // On open: snapshot the section's blocks from the live editor (as items, so
  // the notes_index becomes a draggable card — synthesized at the end when the
  // section has no notes yet), and fetch the study's template (no notes there).
  useEffect(() => {
    if (!open) {
      return;
    }
    const view = editorRef.current?.getBlocksView() ?? null;
    const items = view ? dialogItemsFromDoc(docToJSON(view.state.doc)) : [];
    setSectionItems(items);
    sectionBaseline.current = itemsJson(items);
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
        templateBaseline.current = draftsJson(td);
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

  /** True when the user has unsaved edits in either tab. Flushes any focused
   * body editor first so its blur-commit lands before we compare. */
  function isDirty() {
    (document.activeElement as HTMLElement | null)?.blur();
    return (
      itemsJson(sectionRef.current) !== sectionBaseline.current ||
      draftsJson(templateRef.current) !== templateBaseline.current
    );
  }

  /** Apply the section items to the live blocks editor as one transaction.
   * Rebuilds the entire top-level content from the items list so a reordered
   * notes card lands where the user dropped it; the notes_index's note_entry
   * children are preserved verbatim via the item's `content` payload. */
  function applySectionItems(items: DialogItem[]) {
    const view = editorRef.current?.getBlocksView();
    if (!view) {
      return;
    }
    const tr = view.state.tr;
    const content =
      items.length > 0
        ? jsonToDoc({
            type: "doc",
            content: dialogItemsToDocContent(items),
          }).content
        : null;
    if (content) {
      tr.replaceWith(0, view.state.doc.content.size, content);
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
      itemsJson(sectionRef.current) !== sectionBaseline.current;
    const templateChanged =
      draftsJson(templateRef.current) !== templateBaseline.current;
    if (!sectionChanged && !templateChanged) {
      bypassDirtyCheck.current = true;
      setOpen(false);
      return;
    }

    setSaving(true);
    try {
      if (sectionChanged) {
        applySectionItems(sectionRef.current);
      }
      if (templateChanged) {
        const doc = blocksDocFromSpecs(
          templateRef.current.map(blockSpecFromDraft),
        );
        await saveStudyTemplateBlocksDoc(studyId, doc);
      }
      // Save is the other "user committed to closing" path — skip the discard
      // prompt on the resulting close.
      bypassDirtyCheck.current = true;
      setOpen(false);
      toast.success("Study blocks updated.");
    } catch {
      toast.error("Couldn't save the study blocks.");
    } finally {
      setSaving(false);
    }
  }

  /** Intercepts the dialog's own close attempts (X / Esc / overlay click — all
   * of which Radix routes through onOpenChange(false)). When the user has
   * unsaved edits, we route them through the discard confirm instead of
   * closing. The Cancel button + Save flip `bypassDirtyCheck` first because
   * those are explicit "I'm done" actions. */
  function handleOpenChange(next: boolean) {
    if (next) {
      setOpen(true);
      return;
    }
    if (bypassDirtyCheck.current) {
      bypassDirtyCheck.current = false;
      setOpen(false);
      return;
    }
    if (isDirty()) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <SlidersHorizontal className="size-4" />
          Edit blocks
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-screen w-full max-w-4xl flex-col gap-4">
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
                "flex-1 rounded-md px-2 py-1 text-ui font-medium transition-colors",
                tab === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {labelText}
            </button>
          ))}
        </div>

        {/* Same component as the page's top toolbar — it reads EditorContext,
            so it lights up and acts on whichever card body is currently
            focused. Sits directly above the content it acts on (below the tab
            switcher) so the relationship between toolbar and target is
            unambiguous. The chrome toolbar behind the dialog overlay is dimmed
            but untouched; the dialog's own copy is the one users interact with. */}
        <EditorToolbar
          variant="bar"
          scope="dialog"
          className="rounded-md border bg-card"
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "section" ? (
            <BlockListEditor items={sectionItems} onChange={setSectionItems} />
          ) : templateLoading ? (
            <p className="px-4 py-6 text-center text-ui text-muted-foreground">
              Loading template…
            </p>
          ) : (
            // Template tab has no notes_index — adapt the BlockDraft[] state
            // to the unified items API and strip any unexpected notes item on
            // change (the picker can only add study items, so this is defensive).
            <BlockListEditor
              items={draftsToItems(templateDrafts)}
              onChange={(next) => {
                setTemplateDrafts(itemsToDrafts(next));
              }}
            />
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // Cancel = explicit discard intent; skip the confirm and close.
              bypassDirtyCheck.current = true;
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

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard your changes?"
        description="You have unsaved changes to the study blocks. Closing now will lose them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          bypassDirtyCheck.current = true;
          setOpen(false);
        }}
      />
    </Dialog>
  );
}
