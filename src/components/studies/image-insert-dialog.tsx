"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { imageErrorToast } from "@/lib/editor/image-errors";
import { uploadImage, type UploadResult } from "@/lib/editor/image-upload";
import { cn } from "@/lib/utils";

/**
 * Image insert dialog: two tabs, Upload and From URL. Triggered from every
 * insertion path that needs a chooser (toolbar button, slash-menu `/image`,
 * image-toolbar Replace). Paste + drop bypass this and hit `uploadImage`
 * directly.
 *
 * Returns the upload result via `onInsert(result)` so the caller can build
 * the actual PM transaction (insert-new for normal flow, swap-attrs for
 * Replace). All error toasts are emitted here so the caller's flow stays
 * thin.
 */

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  studyId: string;
  userId: string;
  /** When set, the dialog renders "Replace" copy; otherwise "Add image". */
  mode?: "insert" | "replace";
  onInsert: (result: {
    src: string;
    naturalW: number;
    naturalH: number;
  }) => void;
}

type Tab = "upload" | "url";

export function ImageInsertDialog({
  open,
  onOpenChange,
  studyId,
  userId,
  mode = "insert",
  onInsert,
}: Props) {
  const [tab, setTab] = useState<Tab>("upload");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Reset on close so re-opening starts fresh. We do the reset in the
  // onOpenChange handler (below) rather than an effect — calling setState
  // from inside a useEffect against `open` is the cascading-render footgun
  // the react-hooks/set-state-in-effect rule flags.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setTab("upload");
        setUrl("");
        setBusy(false);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleResult = useCallback(
    (result: UploadResult) => {
      if (!result.ok) {
        imageErrorToast(result.error);
        return;
      }
      onInsert({
        src: result.src,
        naturalW: result.naturalW,
        naturalH: result.naturalH,
      });
      handleOpenChange(false);
    },
    [handleOpenChange, onInsert],
  );

  const runFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const result = await uploadImage({ file, studyId, userId });
        handleResult(result);
      } finally {
        setBusy(false);
      }
    },
    [handleResult, studyId, userId],
  );

  const runUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const result = await uploadImage({ url: trimmed, studyId, userId });
      handleResult(result);
    } finally {
      setBusy(false);
    }
  }, [handleResult, studyId, url, userId]);

  // Focus the URL input when the user switches to the "From URL" tab, with
  // the caret at the end of any existing text. Effect runs on tab + open
  // changes; querying the ref on the same tick the input mounts is fine
  // because the conditional render above places it in the same commit.
  useEffect(() => {
    if (!open || tab !== "url") return;
    const input = urlInputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [open, tab]);

  // Drop-zone wiring. We rebind every render so closures stay fresh.
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    const node = dropZoneRef.current;
    if (!node || tab !== "upload") return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = () => {
      setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) void runFile(file);
    };
    node.addEventListener("dragover", onDragOver);
    node.addEventListener("dragleave", onDragLeave);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragover", onDragOver);
      node.removeEventListener("dragleave", onDragLeave);
      node.removeEventListener("drop", onDrop);
    };
  }, [runFile, tab]);

  const title = mode === "replace" ? "Replace image" : "Add image";
  const description =
    mode === "replace"
      ? "Choose a new image. Crop and alignment will reset."
      : "Upload from your computer or embed from a URL.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b">
          {(["upload", "url"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "px-3 py-2 text-ui transition-colors",
                tab === t
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setTab(t);
              }}
            >
              {t === "upload" ? "Upload" : "From URL"}
            </button>
          ))}
        </div>

        {tab === "upload" ? (
          <div
            ref={dropZoneRef}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center transition-colors",
              dragOver && "border-primary bg-accent",
            )}
          >
            <p className="text-ui text-muted-foreground">
              Drag an image here, or
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void runFile(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              {busy ? "Uploading…" : "Choose file"}
            </Button>
            <p className="text-caption text-muted-foreground">
              JPG, PNG, WebP, GIF, or HEIC · up to 10 MB
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              ref={urlInputRef}
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={url}
              disabled={busy}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !busy) {
                  e.preventDefault();
                  void runUrl();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !url.trim()}
              onClick={() => {
                void runUrl();
              }}
            >
              {busy ? "Fetching…" : "Embed image"}
            </Button>
            <p className="text-caption text-muted-foreground">
              The image is downloaded and stored with your study.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
