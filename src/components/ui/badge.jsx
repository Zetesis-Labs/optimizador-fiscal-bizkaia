import { cn } from "@/lib/utils";
export const Badge = ({ className, variant = "default", ...p }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
      variant === "secondary" ? "bg-stone-100 text-stone-700" : "bg-emerald-700 text-white",
      className
    )}
    {...p}
  />
);
