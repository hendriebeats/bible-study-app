"use client";

import { RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchSectionTimeline } from "@/app/studies/actions";
import { DocPreview } from "@/components/studies/doc-preview";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import type { SectionTimeline } from "@/lib/db/types";
import { diffSince, reconstructDoc } from "@/lib/editor/history-view";
import { docToJSON } from "@/lib/editor/serialize";
import type { PMDocJSON } from "@/lib/editor/types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function VersionHistoryPanel({
  sectionId,
  headVersion,
  onRestore,
  onClose,
}: {
  sectionId: string;
  headVersion: number;
  onRestore: (doc: PMDocJSON) => void;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<SectionTimeline | null>(null);
  const [version, setVersion] = useState(headVersion);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchSectionTimeline(sectionId).then((loaded) => {
      if (active) {
        setTimeline(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [sectionId]);

  const preview = useMemo(() => {
    if (!timeline) {
      return null;
    }
    if (showDiff && version < headVersion) {
      const fromDoc = reconstructDoc(
        version,
        timeline.checkpoints,
        timeline.steps,
      );
      const stepsBetween = timeline.steps.filter(
        (step) => step.version > version && step.version <= headVersion,
      );
      return diffSince(fromDoc, stepsBetween);
    }
    return {
      doc: reconstructDoc(version, timeline.checkpoints, timeline.steps),
      decorations: undefined,
    };
  }, [timeline, version, showDiff, headVersion]);

  function handleRestore() {
    if (!timeline) {
      return;
    }
    onRestore(
      docToJSON(reconstructDoc(version, timeline.checkpoints, timeline.steps)),
    );
  }

  const atHead = version >= headVersion;

  return (
    <>
      <button
        type="button"
        aria-label="Close version history"
        className="fixed inset-0 z-40 bg-foreground/20"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-96 max-w-full flex-col border-l bg-card shadow-lg">
        <header className="flex items-center justify-between p-4">
          <span className="font-semibold">Version history</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        <Separator />

        {headVersion === 0 || !timeline ? (
          <p className="p-4 text-sm text-muted-foreground">
            {timeline ? "No saved history yet." : "Loading…"}
          </p>
        ) : (
          <>
            <div className="space-y-3 p-4">
              <Slider
                min={0}
                max={headVersion}
                step={1}
                value={[version]}
                onValueChange={(values) => {
                  setVersion(values[0] ?? headVersion);
                }}
                aria-label="Version"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Version {version} of {headVersion}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={showDiff ? "secondary" : "ghost"}
                  disabled={atHead}
                  onClick={() => {
                    setShowDiff((value) => !value);
                  }}
                >
                  Show changes
                </Button>
              </div>
            </div>
            <Separator />

            <ScrollArea className="max-h-40 shrink-0">
              <div className="space-y-1 p-2">
                {timeline.checkpoints.map((checkpoint) => (
                  <button
                    key={checkpoint.version}
                    type="button"
                    onClick={() => {
                      setVersion(checkpoint.version);
                    }}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${
                      checkpoint.version === version ? "bg-accent" : ""
                    }`}
                  >
                    <span className="block font-medium">
                      {checkpoint.label ??
                        `Version ${String(checkpoint.version)}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatTime(checkpoint.created_at)}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <Separator />

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {preview ? (
                <DocPreview
                  doc={preview.doc}
                  decorations={preview.decorations}
                />
              ) : null}
            </div>
            <Separator />

            <div className="p-4">
              <Button
                type="button"
                className="w-full"
                disabled={atHead}
                onClick={handleRestore}
              >
                <RotateCcw className="size-4" />
                Restore this version
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
