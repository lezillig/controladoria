import Link from "next/link";
import { Plus, Upload } from "lucide-react";

export default function PageHeader({
  title,
  subtitle,
  actionHref,
  actionLabel,
  secondaryActionHref,
  secondaryActionLabel,
}: {
  title: string;
  subtitle?: string;
  actionHref?: string;
  actionLabel?: string;
  secondaryActionHref?: string;
  secondaryActionLabel?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {secondaryActionHref && secondaryActionLabel && (
          <Link
            href={secondaryActionHref}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload className="h-4 w-4" />
            {secondaryActionLabel}
          </Link>
        )}
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            <Plus className="h-4 w-4" />
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
