'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_KEY = 'sk_theme';
/** Runs in <head> before first paint (layout.tsx), so a dark page never flashes white. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;

/** Light/dark switch. A saved choice wins; with none saved, the portal follows the OS setting. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.dataset.theme === 'dark');
    read();
    // Several toggles can be on one page (sidebar + top bar): they all watch the attribute.
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    // No saved choice: keep following the OS if it switches while the page is open.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onOs = (e: MediaQueryListEvent) => { if (!saved()) root.dataset.theme = e.matches ? 'dark' : 'light'; };
    mq.addEventListener('change', onOs);
    return () => { mo.disconnect(); mq.removeEventListener('change', onOs); };
  }, []);

  function flip() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: still switches for this visit */ }
  }

  return (
    <button type="button" className={`btn subtle icon-btn ${className}`} onClick={flip} aria-label="Dark mode" aria-pressed={dark ?? undefined} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </button>
  );
}

function saved(): boolean {
  try { return !!localStorage.getItem(THEME_KEY); } catch { return false; }
}
