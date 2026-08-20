import { useTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<Theme, string> = { light: '☀️ Claro', dark: '🌙 Escuro', system: '🖥️ Sistema' };

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <button
      onClick={() => setTheme(NEXT[theme])}
      title="Alternar tema"
      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {LABEL[theme]}
    </button>
  );
}
