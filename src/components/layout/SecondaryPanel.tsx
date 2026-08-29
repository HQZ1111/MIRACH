import { cn } from "@/lib/utils";

interface SecondaryPanelProps {
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children?: React.ReactNode;
  onClose?: () => void;
}

export function SecondaryPanel({
  className,
  style,
  title = "Details",
  children,
  onClose,
}: SecondaryPanelProps) {
  return (
    <aside className={cn("flex flex-col border-l border-border bg-white", className)} style={style}>
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="text-subheading font-medium uppercase tracking-wider text-foreground">
          {title}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-body-sm text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {children ?? (
          <p className="py-8 text-center text-body-sm text-muted-foreground">
            No details
          </p>
        )}
      </div>
    </aside>
  );
}
