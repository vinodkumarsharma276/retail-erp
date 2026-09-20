import type { Config } from 'tailwindcss';

/**
 * Colours are declared as `hsl(var(--token) / <alpha-value>)` so every utility
 * supports an opacity modifier (`bg-primary/10`, `border-success/30`). Tokens
 * themselves live in `src/index.css` and are redefined under `.dark`.
 */
const withAlpha = (token: string) => `hsl(var(${token}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: withAlpha('--border'),
        'border-strong': withAlpha('--border-strong'),
        input: withAlpha('--input'),
        ring: withAlpha('--ring'),
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        subtle: withAlpha('--subtle'),

        surface: {
          DEFAULT: withAlpha('--surface'),
          foreground: withAlpha('--surface-foreground'),
        },
        primary: {
          DEFAULT: withAlpha('--primary'),
          foreground: withAlpha('--primary-foreground'),
          hover: withAlpha('--primary-hover'),
          muted: withAlpha('--primary-muted'),
        },
        secondary: {
          DEFAULT: withAlpha('--secondary'),
          foreground: withAlpha('--secondary-foreground'),
        },
        destructive: {
          DEFAULT: withAlpha('--destructive'),
          foreground: withAlpha('--destructive-foreground'),
          muted: withAlpha('--destructive-muted'),
        },
        success: {
          DEFAULT: withAlpha('--success'),
          foreground: withAlpha('--success-foreground'),
          muted: withAlpha('--success-muted'),
        },
        warning: {
          DEFAULT: withAlpha('--warning'),
          foreground: withAlpha('--warning-foreground'),
          muted: withAlpha('--warning-muted'),
        },
        info: {
          DEFAULT: withAlpha('--info'),
          foreground: withAlpha('--info-foreground'),
          muted: withAlpha('--info-muted'),
        },
        muted: {
          DEFAULT: withAlpha('--muted'),
          foreground: withAlpha('--muted-foreground'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          foreground: withAlpha('--accent-foreground'),
        },
        card: {
          DEFAULT: withAlpha('--card'),
          foreground: withAlpha('--card-foreground'),
        },
        popover: {
          DEFAULT: withAlpha('--popover'),
          foreground: withAlpha('--popover-foreground'),
        },
        sidebar: {
          DEFAULT: withAlpha('--sidebar'),
          foreground: withAlpha('--sidebar-foreground'),
          muted: withAlpha('--sidebar-muted'),
          border: withAlpha('--sidebar-border'),
          active: withAlpha('--sidebar-active'),
          'active-foreground': withAlpha('--sidebar-active-foreground'),
          hover: withAlpha('--sidebar-hover'),
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      fontSize: {
        // Slightly tighter tracking on large text; ERP headings read better dense.
        '2xl': ['1.5rem', { lineHeight: '1.875rem', letterSpacing: '-0.02em' }],
        xl: ['1.25rem', { lineHeight: '1.625rem', letterSpacing: '-0.015em' }],
        lg: ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
      },
      spacing: {
        // Shell dimensions referenced by the layout, sidebar and header.
        header: '3.5rem',
        sidebar: '15rem',
        'sidebar-rail': '3.75rem',
      },
      zIndex: {
        sidebar: '50',
        backdrop: '40',
        dropdown: '60',
        toast: '80',
      },
    },
  },
  plugins: [],
} satisfies Config;
