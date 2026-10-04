import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebarBg: '#F8FAFC',
        aiMsgBg: '#F8FAFC',
        titlePurple: '#8B5CF6',
        gradStart: '#818CF8',
        gradEnd: '#A78BFA',
        darkSidebarBg: '#0F172A',
        darkAiMsgBg: '#0F172A',
        darkTitlePurple: '#A78BFA',
        darkGradStart: '#6366F1',
        darkGradEnd: '#8B5CF6',
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          DEFAULT: '#3b82f6'
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      typography: (theme: any) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.gray.700'),
            '--tw-prose-headings': theme('colors.gray.900'),
            '--tw-prose-lead': theme('colors.gray.600'),
            '--tw-prose-links': theme('colors.primary.600'),
            '--tw-prose-bold': theme('colors.gray.900'),
            '--tw-prose-counters': theme('colors.gray.500'),
            '--tw-prose-bullets': theme('colors.gray.300'),
            '--tw-prose-hr': theme('colors.gray.200'),
            '--tw-prose-quotes': theme('colors.gray.900'),
            '--tw-prose-quote-borders': theme('colors.gray.200'),
            '--tw-prose-captions': theme('colors.gray.500'),
            '--tw-prose-code': theme('colors.secondary.700'),
            '--tw-prose-pre-code': theme('colors.secondary.200'),
            '--tw-prose-pre-bg': theme('colors.secondary.800'),
            '--tw-prose-th-borders': theme('colors.gray.300'),
            '--tw-prose-td-borders': theme('colors.gray.200'),
            '--tw-prose-invert-body': theme('colors.gray.300'),
            '--tw-prose-invert-headings': theme('colors.white'),
            '--tw-prose-invert-lead': theme('colors.gray.400'),
            '--tw-prose-invert-links': theme('colors.primary.400'),
            '--tw-prose-invert-bold': theme('colors.white'),
            '--tw-prose-invert-counters': theme('colors.gray.400'),
            '--tw-prose-invert-bullets': theme('colors.gray.600'),
            '--tw-prose-invert-hr': theme('colors.gray.700'),
            '--tw-prose-invert-quotes': theme('colors.gray.100'),
            '--tw-prose-invert-quote-borders': theme('colors.gray.700'),
            '--tw-prose-invert-captions': theme('colors.gray.400'),
            '--tw-prose-invert-code': theme('colors.secondary.300'),
            '--tw-prose-invert-pre-code': theme('colors.secondary.300'),
            '--tw-prose-invert-pre-bg': theme('colors.secondary.900'),
            '--tw-prose-invert-th-borders': theme('colors.gray.600'),
            '--tw-prose-invert-td-borders': theme('colors.gray.700'),
          },
        },
      }),
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config; 