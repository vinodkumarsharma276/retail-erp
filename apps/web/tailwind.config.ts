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
        // Fill colour for form controls — never use `bg-background` on a
        // field; that's the app canvas and makes inputs look disabled.
        field: withAlpha('--field'),
        ring: withAlpha('--ring'),
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        subtle: withAlpha('--subtle'),

        surface: {
          DEFAULT: withAlpha('--surface'),
          foreground: withAlpha('--surface-foreground'),
        },
        // Second brand hue — only for gradients and highlights, never text.
        brand: {
          2: withAlpha('--brand-2'),
          3: withAlpha('--brand-3'),
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
        glow: 'var(--shadow-glow)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: [
          'IBM Plex Sans',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        // Headings and hero numbers.
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        // Amounts, ledger numbers, stat figures.
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Slightly tighter tracking on large text; ERP headings read better dense.
        '2xl': ['1.5rem', { lineHeight: '1.875rem', letterSpacing: '-0.02em' }],
        xl: ['1.25rem', { lineHeight: '1.625rem', letterSpacing: '-0.015em' }],
        lg: ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
      },
      spacing: {
        // Shell dimensions referenced by the layout, sidebar and header.
        // NOTE: these are config-level additions, so a dev server restart is
        // required after changing them — Vite does not always hot-reload
        // tailwind.config.ts, and a missing class silently falls back to
        // content-driven sizing rather than erroring.
        header: '4rem',
        sidebar: '17rem',
        'sidebar-rail': '4rem',
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
