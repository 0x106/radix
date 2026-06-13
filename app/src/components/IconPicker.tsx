"use client";

import { ICON_NAMES, ICONS, DEFAULT_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/** A grid of the curated icons; calls onSelect with the chosen icon name. */
export function IconPicker({
  value,
  onSelect,
}: {
  value?: string | null;
  onSelect: (name: string) => void;
}) {
  const current = (value && ICONS[value]) ? value : DEFAULT_ICON;
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name];
        const active = name === current;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            aria-pressed={active}
            className={cn(
              "flex aspect-square items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent"
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
