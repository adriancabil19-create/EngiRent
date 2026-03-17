export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: 'EngiRent Hub',
  description: 'Smart kiosk rentals for engineering students with AI-backed verification.',
  navItems: [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about' },
    { label: 'Docs', href: '/docs' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Blog', href: '/blog' },
  ],
  navMenuItems: [
    { label: 'Owner Flow', href: '/docs#owner-flow' },
    { label: 'Renter Flow', href: '/docs#renter-flow' },
    { label: 'Verification', href: '/docs#verification' },
    { label: 'Security', href: '/docs#security' },
    { label: 'Contact', href: '/about#contact' },
  ],
  links: {
    github: 'https://github.com/',
    docs: '/docs',
    admin: 'http://localhost:3001',
    mobile: '#',
  },
};
