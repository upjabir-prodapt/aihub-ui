import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import './ThemeToggle.css';

interface ThemeToggleProps {
  /** Pass 'on-hero' when placing this over a colored/gradient background
   * (e.g. Landing's teal hero) where the default surface-colored button
   * would be invisible. */
  variant?: 'default' | 'on-hero';
}

export default function ThemeToggle({ variant = 'default' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const label = t('theme.switchTo', { theme: t(`theme.${nextTheme}`) });

  return (
    <button
      type="button"
      className={`theme-toggle${variant === 'on-hero' ? ' theme-toggle--on-hero' : ''}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
