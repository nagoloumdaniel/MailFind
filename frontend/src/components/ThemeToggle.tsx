import { useState } from 'react';
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from '../lib/theme';

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Systeme' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);

  function select(next: ThemeChoice) {
    applyThemeChoice(next);
    setChoice(next);
  }

  return (
    <fieldset className="inline-flex rounded-[var(--radius-sm)] border border-line">
      <legend className="sr-only">Theme de l&apos;interface</legend>
      {CHOICES.map(({ value, label }) => (
        <label
          key={value}
          className={`cursor-pointer px-2 py-1 text-xs ${
            choice === value ? 'bg-raised font-medium text-text' : 'text-text-faint'
          }`}
        >
          <input
            type="radio"
            name="theme"
            value={value}
            checked={choice === value}
            onChange={() => {
              select(value);
            }}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
