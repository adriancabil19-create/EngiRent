import { tv } from 'tailwind-variants';

export const title = tv({
  base: 'tracking-tight inline font-extrabold text-[var(--brand-ink)]',
  variants: {
    color: {
      primary: 'text-[var(--brand-primary)]',
      secondary: 'text-[var(--brand-secondary)]',
      accent: 'text-[var(--brand-accent)]',
      foreground: 'text-[var(--brand-ink)]',
    },
    size: {
      sm: 'text-3xl lg:text-4xl',
      md: 'text-[2.1rem] lg:text-5xl',
      lg: 'text-4xl lg:text-6xl',
    },
    fullWidth: {
      true: 'w-full block',
    },
  },
  defaultVariants: {
    size: 'md',
    color: 'foreground',
  },
});

export const subtitle = tv({
  base: 'w-full max-w-3xl text-base sm:text-lg text-[var(--brand-muted)]',
});
