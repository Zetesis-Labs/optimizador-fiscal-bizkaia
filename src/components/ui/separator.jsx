import { cn } from "@/lib/utils";
export const Separator = ({ className, ...p }) => (
  <hr className={cn("border-t border-stone-200", className)} {...p} />
);
