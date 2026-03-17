export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <section className="space-y-6 py-2 sm:py-4">{children}</section>;
}
