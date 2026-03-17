'use client';

import {
  Navbar as HeroUINavbar,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
  NavbarBrand,
  NavbarItem,
  NavbarMenuItem,
} from '@heroui/navbar';
import { Button } from '@heroui/button';
import { Link } from '@heroui/link';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

import { siteConfig } from '@/config/site';
import { ThemeSwitch } from '@/components/theme-switch';
import { Logo } from '@/components/icons';

export const Navbar = () => {
  const pathname = usePathname();

  return (
    <HeroUINavbar
      maxWidth="xl"
      position="sticky"
      className="border-b border-[var(--brand-border)] bg-[var(--brand-surface)]/90 backdrop-blur"
    >
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <NextLink className="flex items-center gap-2" href="/">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-white">
              <Logo size={18} />
            </span>
            <div className="leading-tight">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-muted)]">Smart Kiosk</p>
              <p className="font-extrabold text-[var(--brand-ink)]">{siteConfig.name}</p>
            </div>
          </NextLink>
        </NavbarBrand>
        <ul className="ml-3 hidden gap-5 lg:flex">
          {siteConfig.navItems.map((item) => (
            <NavbarItem key={item.href}>
              <NextLink
                className={clsx(
                  'text-sm font-semibold transition',
                  pathname === item.href ? 'text-[var(--brand-primary)]' : 'text-[var(--brand-muted)] hover:text-[var(--brand-ink)]',
                )}
                href={item.href}
              >
                {item.label}
              </NextLink>
            </NavbarItem>
          ))}
        </ul>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex" justify="end">
        <NavbarItem>
          <ThemeSwitch />
        </NavbarItem>
        <NavbarItem className="hidden md:flex">
          <Button
            as={Link}
            href={siteConfig.links.docs}
            className="font-semibold text-white"
            style={{ background: 'var(--brand-primary)' }}
            radius="sm"
          >
            Read Docs
          </Button>
        </NavbarItem>
      </NavbarContent>

      <NavbarContent className="sm:hidden basis-1 pl-4" justify="end">
        <ThemeSwitch />
        <NavbarMenuToggle />
      </NavbarContent>

      <NavbarMenu>
        <div className="mx-3 mt-3 flex flex-col gap-2">
          {siteConfig.navItems.map((item) => (
            <NavbarMenuItem key={item.href}>
              <NextLink
                href={item.href}
                className={clsx(
                  'block rounded-xl px-3 py-2 text-base font-semibold transition',
                  pathname === item.href
                    ? 'bg-[var(--brand-soft)] text-[var(--brand-primary)]'
                    : 'text-[var(--brand-muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-ink)]',
                )}
              >
                {item.label}
              </NextLink>
            </NavbarMenuItem>
          ))}
          <Button
            as={Link}
            href={siteConfig.links.docs}
            className="mt-2 font-semibold text-white"
            style={{ background: 'var(--brand-primary)' }}
          >
            Read Docs
          </Button>
        </div>
      </NavbarMenu>
    </HeroUINavbar>
  );
};
