import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';

const control =
  'block w-full rounded-brand border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60';

/** A labelled form control. The label wraps the control, so no id wiring is needed. */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block text-sm', className)}>
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-10', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24', className)} {...props} />;
}

const tones = {
  neutral: 'bg-background text-muted border-border',
  success: 'bg-[#e6f2ee] text-[#0b6b52] border-[#b9dccf]',
  warning: 'bg-[#fdf3dc] text-[#7a5200] border-[#f1d9a0]',
  danger: 'bg-[#fbe9e9] text-[#9b1c1c] border-[#efc4c4]',
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-block rounded-full border px-2 py-0.5 text-xs font-medium first-letter:uppercase', tones[tone])}>
      {children}
    </span>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: Exclude<Tone, 'neutral'>; children: ReactNode }) {
  return (
    <p role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-brand border px-3 py-2 text-sm', tones[tone])}>
      {children}
    </p>
  );
}

/** A scrollable table wrapper. Headers use scope="col" for screen readers. */
export function Table({ caption, head, children }: { caption: string; head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-brand border border-border bg-surface">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-background text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" className="px-4 py-2 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, children }: { className?: string; children: ReactNode }) {
  return <td className={cn('px-4 py-3 align-top', className)}>{children}</td>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
