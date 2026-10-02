import { MessagesSquare } from 'lucide-react';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-brand-ink shadow-sm">
        <MessagesSquare className="h-5 w-5" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">MonitorGroup</p>
          <p className="text-[11px] text-muted">Monitor de WhatsApp</p>
        </div>
      )}
    </div>
  );
}
