"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const SIZES = {
  /** Confirmations and short forms. */
  sm: "max-w-md",
  /** A whole record form — the company/contact quick-create. */
  lg: "max-w-2xl",
} as const;

/** Lightweight modal dialog, portalled to <body> so it never nests inside a parent <form>. */
export function Modal({
  open,
  onClose,
  title,
  size = "sm",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: keyof typeof SIZES;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Closed on first render (server + client), so createPortal only runs client-side.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 max-h-[90vh] w-full ${SIZES[size]} overflow-y-auto rounded-lg border bg-card p-5 shadow-lg`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
