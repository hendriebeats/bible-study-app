"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { updateOrgIcon } from "@/app/organizations/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/avatar";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024;

export function OrgIconUpload({
  orgId,
  orgName,
  iconUrl,
}: {
  orgId: string;
  orgName: string;
  iconUrl: string | null;
}) {
  const [url, setUrl] = useState(iconUrl);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be under 2 MB.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${orgId}/icon-${String(Date.now())}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("org-icons")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) {
        toast.error(uploadError.message);
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("org-icons").getPublicUrl(path);
      await updateOrgIcon(orgId, publicUrl);
      setUrl(publicUrl);
      toast.success("Icon updated.");
    } catch {
      toast.error("Couldn't update the icon. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await updateOrgIcon(orgId, null);
      setUrl(null);
      toast.success("Icon removed.");
    } catch {
      toast.error("Couldn't remove the icon.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16 rounded-lg">
        {url ? <AvatarImage src={url} alt={orgName} /> : null}
        <AvatarFallback className="rounded-lg text-lg">
          {getInitials(orgName)}
        </AvatarFallback>
      </Avatar>
      <div className="grid gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            event.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            {busy ? "Working…" : "Upload icon"}
          </Button>
          {url ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                void handleRemove();
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">PNG or JPG, up to 2 MB.</p>
      </div>
    </div>
  );
}
