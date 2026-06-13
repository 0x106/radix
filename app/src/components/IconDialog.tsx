"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconPicker } from "@/components/IconPicker";

/** A dialog wrapping the IconPicker; picking an icon applies it and closes. */
export function IconDialog({
  open,
  onOpenChange,
  title,
  value,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value?: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <IconPicker
          value={value}
          onSelect={(name) => {
            onSelect(name);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
