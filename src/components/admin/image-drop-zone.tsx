import { useRef, useState, type ReactNode } from "react";
import { IMAGE_ACCEPT } from "@/components/admin/image-limits";
import { cn } from "@/lib/utils";

/**
 * The dashed drop target the admin uploaders share: click, Enter/Space or drop
 * hands the files to `onFiles`. A button inside needs no handler of its own:
 * its click reaches the zone, which is what a phone, with nothing to drop from, taps.
 */
export function ImageDropZone({
  onFiles,
  multiple = false,
  busy = false,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const open = () => inputRef.current?.click();
  const take = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      onClick={() => !busy && open()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "cursor-pointer rounded-lg border border-dashed text-center transition-colors",
        dragging
          ? "border-primary bg-primary/10"
          : "border-border-strong hover:border-primary/50 hover:bg-white/[0.02]",
        busy && "pointer-events-none opacity-60",
        className,
      )}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
