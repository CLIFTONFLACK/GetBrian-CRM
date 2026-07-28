import { cn } from "@/lib/utils";

// error keeps its literal red-* classes (no --destructive equivalent for this
// tint — that token is red-600, not the red-700 used here, so switching would
// shift the color). success/warning use the token tint: --success/--warning
// exactly equal the emerald-700/amber-700 literals they replace, in both
// light and dark, so this is a zero-visual-change dedup for those two tones.
const TONE: Record<"error" | "success" | "warning", string> = {
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

export function Alert({
  tone,
  className,
  children,
}: {
  tone: keyof typeof TONE;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Errors are announced: most appear after a form submit, and a red box alone
    // is invisible to a screen reader.
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn("rounded-md border px-3 py-2 text-sm", TONE[tone], className)}
    >
      {children}
    </p>
  );
}
