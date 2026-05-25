"use client";

import { MoreVertical, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { deleteStudy } from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Study } from "@/lib/db/types";

export function StudyCard({ study }: { study: Study }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="relative">
      <Link href={`/studies/${study.id}`}>
        <Card className="h-full transition-colors hover:border-primary/60">
          <CardHeader>
            <CardTitle className="truncate pr-8 text-lg">
              {study.title}
            </CardTitle>
            <CardDescription>
              Updated{" "}
              {new Date(study.updated_at).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <div className="absolute top-2 right-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Study options"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  void deleteStudy(study.id);
                });
              }}
            >
              <Trash2 className="size-4" />
              Move to trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
