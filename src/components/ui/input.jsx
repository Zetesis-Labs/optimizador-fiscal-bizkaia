import { cn } from "@/lib/utils";
export const Input = ({ className, ...p }) => (
  <input
    className={cn(
      "flex h-9 w-full rounded-md border border-stone-200 bg-white px-3 py-1 text-sm",
      "placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...p}
  />
);
