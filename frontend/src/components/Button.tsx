import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Trois roles, pas trois habillages. `primary` est ambre et il n'y en a qu'un
 * par ecran ; `default` porte les actions courantes ; `danger` previent que
 * l'action ne se reprend pas.
 */
type Tone = 'primary' | 'default' | 'danger';

const TONES: Record<Tone, string> = {
  primary:
    'bg-accent text-accent-contrast border-accent hover:bg-accent-strong hover:border-accent-strong',
  default: 'bg-surface text-text border-line-strong hover:bg-raised',
  danger: 'bg-surface text-negative border-negative/50 hover:bg-negative hover:text-text-inverse',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  children: ReactNode;
}

export function Button({ tone = 'default', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${className}`}
    >
      {children}
    </button>
  );
}
