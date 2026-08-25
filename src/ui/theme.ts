// AUTO-SYNCED from mns-ui — do not edit here. Edit mns-ui/src/theme.ts and run sync.sh.
// Theme switching — follow-the-phone by default, explicit choice wins
// and is remembered. Stamps data-theme on <html>; tokens.css does the
// rest. Synced into each repo as src/ui/theme.ts by sync.sh.

import { useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mns-theme'

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function storedTheme(): ThemeChoice {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

// Call once at app start, before first paint if possible.
export function initTheme(): void {
  applyTheme(storedTheme())
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme)
  useEffect(() => {
    applyTheme(choice)
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  }, [choice])
  return [choice, setChoice]
}
