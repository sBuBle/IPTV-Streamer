import { h } from 'preact';
import { AlertCircle, CheckCircle2, X } from 'lucide-preact';

// Shared FigCraft building blocks for the Settings and Playlists pages
// (tokens from src/index.css)

export const field = 'w-full h-11 px-4 rounded-xl bg-[var(--color-ink)] border border-white/8 text-sm text-[var(--color-text)] placeholder:text-[var(--color-subtle)] focus:outline-none focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/25 transition';
export const iconButton = 'h-9 w-9 rounded-[10px] flex items-center justify-center text-[var(--color-muted)] hover:text-white hover:bg-white/8 transition disabled:opacity-40 disabled:pointer-events-none';
export const pill = 'shrink-0 inline-flex items-center h-[22px] px-2 rounded-full bg-white/6 text-[11px] font-semibold text-[var(--color-muted)] whitespace-nowrap';

export function Section({ id, icon: Icon, title, description, action, children }) {
  return (
    <section id={id} class="scroll-mt-6">
      <div class="flex items-end gap-3 mb-3">
        <div class="flex-1 min-w-0">
          <h3 class="flex items-center gap-2 text-xl font-semibold text-[var(--color-text)]">
            <Icon class="w-5 h-5 text-[var(--color-lilac)]" aria-hidden="true" />
            {title}
          </h3>
          {description && <p class="mt-1 text-sm text-[var(--color-muted)]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, class: extra = '' }) {
  return (
    <div class={`rounded-2xl bg-[var(--color-card)] border border-[var(--color-hairline)] ${extra}`}>
      {children}
    </div>
  );
}

// One preference: label + hint on the left, control on the right
export function Row({ title, hint, children, stack = false }) {
  return (
    <div class={`flex ${stack ? 'flex-col sm:flex-row sm:items-center' : 'items-center'} gap-3 sm:gap-6 px-5 py-4 border-t border-[var(--color-hairline)] first:border-t-0`}>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-[var(--color-text)]">{title}</div>
        {hint && <div class="mt-0.5 text-[13px] text-[var(--color-muted)]">{hint}</div>}
      </div>
      <div class="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      class={`relative w-11 h-6 rounded-full transition ${
        checked ? 'bg-[linear-gradient(135deg,#8b5cf6,#f43f5e)] shadow-[var(--shadow-glow)]' : 'bg-white/10 ring-1 ring-inset ring-white/10'
      }`}
    >
      <span class={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div class="inline-flex flex-wrap p-1 gap-1 rounded-xl bg-[var(--color-ink)] border border-[var(--color-hairline)]" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          class={`h-8 px-3 rounded-[9px] flex items-center gap-1.5 text-[13px] font-semibold transition ${
            value === option.value ? 'bg-white/10 text-white' : 'text-[var(--color-muted)] hover:text-white'
          }`}
        >
          {option.icon && <option.icon class="w-4 h-4" aria-hidden="true" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ notice, onClose }) {
  if (!notice) return null;
  const ok = notice.type === 'success';
  return (
    <div
      role="status"
      class={`flex items-start gap-3 p-4 rounded-2xl border text-sm ${
        ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' : 'bg-rose-500/10 border-rose-500/30 text-rose-100'
      }`}
    >
      {ok
        ? <CheckCircle2 class="w-5 h-5 shrink-0 text-emerald-400" />
        : <AlertCircle class="w-5 h-5 shrink-0 text-[var(--color-live)]" />}
      <p class="flex-1 whitespace-pre-line">{notice.text}</p>
      <button type="button" onClick={onClose} class="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
        <X class="w-4 h-4" />
      </button>
    </div>
  );
}
