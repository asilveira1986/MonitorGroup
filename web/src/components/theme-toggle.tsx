'use client';

import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* sem armazenamento local */
    }
  }

  return (
    <button
      onClick={toggle}
      className="rounded-xl p-2 text-ink-2 transition hover:bg-surface-2 hover:text-ink"
      aria-label="Alternar tema claro/escuro"
      title="Alternar tema"
    >
      <Sun className="hidden h-5 w-5 [[data-theme=dark]_&]:block" />
      <Moon className="h-5 w-5 [[data-theme=dark]_&]:hidden" />
    </button>
  );
}
