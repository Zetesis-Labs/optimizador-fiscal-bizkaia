import { cn } from "@/lib/utils";
export const Card = ({ className, ...p }) => (
  <div className={cn("rounded-xl border border-stone-200 bg-white shadow-sm", className)} {...p} />
);
export const CardHeader = ({ className, ...p }) => (
  <div className={cn("flex flex-col space-y-1 p-4 pb-2", className)} {...p} />
);
export const CardTitle = ({ className, ...p }) => (
  <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...p} />
);
export const CardDescription = ({ className, ...p }) => (
  <p className={cn("text-sm text-stone-500", className)} {...p} />
);
export const CardContent = ({ className, ...p }) => (
  <div className={cn("p-4 pt-2", className)} {...p} />
);
