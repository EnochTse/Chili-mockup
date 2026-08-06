import Link from "next/link";
import type { ReactNode } from "react";
import ChiliLogo from "@/components/chili-logo";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type ApplicationShellProps = {
  actions?: ReactNode;
  children: ReactNode;
  mode: string;
};

export default function ApplicationShell({
  actions,
  children,
  mode
}: ApplicationShellProps) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only fixed top-4 left-4 z-50 rounded-control bg-foreground px-4 py-3 font-semibold text-background shadow-ds-overlay focus:not-sr-only"
      >
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen px-4 pb-12 sm:px-6 lg:px-8"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
          <header className="sticky top-0 z-40 pt-3">
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-panel border border-border/80 bg-surface-translucent px-3 py-2 shadow-ds-elevated backdrop-blur-xl sm:flex-nowrap sm:px-4">
              <Link
                href="/"
                aria-label="Chili product library"
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-foreground transition-opacity duration-[var(--motion-duration-fast)] hover:opacity-75 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <ChiliLogo className="h-auto w-24" />
              </Link>

              {actions ? (
                <nav aria-label="Primary" className="flex items-center gap-2">
                  {actions}
                  <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
                  <Badge variant="secondary" className="min-h-7 px-3">
                    {mode}
                  </Badge>
                </nav>
              ) : (
                <Badge variant="secondary" className="min-h-7 px-3">
                  {mode}
                </Badge>
              )}
            </div>
          </header>

          {children}
        </div>
      </main>
    </>
  );
}
