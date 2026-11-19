import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react'
import { useToasts } from '@/lib/toasts'
import { cn } from '@/lib/utils'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[70] flex w-[380px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="animate-pop-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-pop"
        >
          <span className={cn('mt-px', t.kind === 'success' ? 'text-emerald-500' : t.kind === 'error' ? 'text-red-500' : 'text-amber-500')}>
            {t.kind === 'success' ? <CircleCheck size={16} /> : t.kind === 'error' ? <CircleExclamationPoint size={16} /> : <Info size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium">{t.message}</div>
            {t.detail && <div className="mt-0.5 line-clamp-4 text-[12px] whitespace-pre-line text-muted select-text">{t.detail}</div>}
          </div>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
              className="rounded-md px-2 py-0.5 text-[12px] font-semibold text-accent-fg hover:bg-accent-soft"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-faint hover:text-fg">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
