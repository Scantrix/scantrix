"use client";

import * as React from "react";
import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses destructive styling and is disabled. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog built on the native <dialog> element.
 *
 * - Focus-trapped automatically by the browser
 * - Closes on Escape
 * - Backdrop click dismisses
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync open state with the native dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Close on Escape (native dialog fires this) and backdrop click
  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      if (!loading) onCancel();
    },
    [loading, onCancel],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      // Only close when the click is on the backdrop (the dialog element itself)
      if (e.target === dialogRef.current && !loading) {
        onCancel();
      }
    },
    [loading, onCancel],
  );

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className={cn(
        // reset browser defaults
        "fixed inset-0 z-50 m-auto rounded-lg border border-border bg-card p-0 text-card-foreground shadow-2xl",
        "w-full max-w-md backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        // entry animation
        "animate-in fade-in-0 zoom-in-95",
      )}
    >
      <div className="space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        {/* Title */}
        <h2 className="text-lg font-semibold leading-tight tracking-tight">
          {title}
        </h2>

        {/* Body */}
        <p className="text-sm text-muted-foreground">{description}</p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
