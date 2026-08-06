"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  PackageOpenIcon
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import ApplicationShell from "@/components/application-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  listItemVariants,
  listRevealVariants,
  pageRevealVariants
} from "@/lib/motion";
import {
  isLiveTemplateDatabaseConfigured,
  listPublishedLiveTemplateSummaries
} from "@/lib/services/live-template-database.service";
import {
  getLocalLibraryClientSnapshot,
  isLocalStudioBrowser
} from "@/lib/services/local-library.client";
import type { TemplateSummaryDto } from "@/lib/types";

type TemplateLibraryHomeProps = {
  initialTemplates: TemplateSummaryDto[];
};

type CatalogStatus = "loading" | "slow" | "ready" | "degraded";

function mergePublishedSummaries(
  initialTemplates: TemplateSummaryDto[],
  overridingTemplates: TemplateSummaryDto[]
) {
  const templatesBySlug = new Map(initialTemplates.map((template) => [template.slug, template]));

  for (const template of overridingTemplates) {
    templatesBySlug.set(template.slug, template);
  }

  return Array.from(templatesBySlug.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function CatalogSkeleton() {
  return (
    <section
      aria-label="Loading product templates"
      aria-busy="true"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} aria-hidden="true" className="gap-0 py-0">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <CardHeader className="gap-3 py-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}

export default function TemplateLibraryHome({
  initialTemplates
}: TemplateLibraryHomeProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("loading");
  const [showLocalStudioLink, setShowLocalStudioLink] = useState(false);
  const [localPublishedSlugs, setLocalPublishedSlugs] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    let isCancelled = false;
    const localBrowser = isLocalStudioBrowser();
    const slowStatusTimer = window.setTimeout(() => {
      if (!isCancelled) {
        setCatalogStatus((currentStatus) =>
          currentStatus === "loading" ? "slow" : currentStatus
        );
      }
    }, 5000);
    setShowLocalStudioLink(localBrowser);

    async function loadPublishedCatalog() {
      let nextTemplates = initialTemplates;
      let hadLoadingIssue = false;

      if (isLiveTemplateDatabaseConfigured()) {
        try {
          const liveTemplates = await listPublishedLiveTemplateSummaries(initialTemplates);
          nextTemplates = mergePublishedSummaries(nextTemplates, liveTemplates);
        } catch {
          hadLoadingIssue = true;
          // Keep checked-in products available while live data is temporarily unavailable.
        }
      }

      if (localBrowser) {
        try {
          const snapshot = await getLocalLibraryClientSnapshot();
          if (isCancelled) return;
          startTransition(() => {
            setLocalPublishedSlugs(
              new Set(snapshot.publishedSummaries.map((template) => template.slug))
            );
          });
          nextTemplates = mergePublishedSummaries(
            nextTemplates,
            snapshot.publishedSummaries
          );
        } catch {
          hadLoadingIssue = true;
          // Local Studio may be disabled while the public catalog remains usable.
        }
      }

      if (!isCancelled) {
        window.clearTimeout(slowStatusTimer);
        startTransition(() => {
          setTemplates(nextTemplates);
          setCatalogStatus(hadLoadingIssue ? "degraded" : "ready");
        });
      }
    }

    void loadPublishedCatalog();

    return () => {
      isCancelled = true;
      window.clearTimeout(slowStatusTimer);
    };
  }, [initialTemplates]);

  const firstTemplate = templates[0] || null;
  const checkedInSlugs = new Set(initialTemplates.map((template) => template.slug));

  function getMockupHref(slug: string) {
    return localPublishedSlugs.has(slug) || !checkedInSlugs.has(slug)
      ? `/mockup?slug=${encodeURIComponent(slug)}`
      : `/mockup/${slug}`;
  }

  const shellActions = showLocalStudioLink ? (
    <Button asChild variant="outline" size="sm">
      <Link href="/setup">Local Studio</Link>
    </Button>
  ) : null;

  return (
    <ApplicationShell mode="Template library" actions={shellActions}>
      <m.section
        initial="hidden"
        animate="visible"
        variants={pageRevealVariants}
        className="grid gap-6 rounded-panel border border-border bg-card p-6 shadow-ds-card sm:p-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-end"
      >
        <div className="max-w-3xl">
          <p className="mb-3 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            Chili workflow
          </p>
          <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            Choose a product and build a faster mockup review flow
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Start from a prepared product template, then review colours, artwork and finishes in
            one focused workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {firstTemplate ? (
              <Button asChild size="lg">
                <Link href={getMockupHref(firstTemplate.slug)}>
                  Open first mockup
                  <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
            {showLocalStudioLink ? (
              <Button asChild variant="outline" size="lg">
                <Link href="/setup">Manage local products</Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="rounded-card border border-border bg-muted/55 p-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Catalog status
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
            {templates.length}
          </p>
          <div
            className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {catalogStatus === "loading" || catalogStatus === "slow" ? (
              <Spinner aria-hidden="true" />
            ) : null}
            <span>
              {catalogStatus === "loading"
                ? "Checking for updates…"
                : catalogStatus === "slow"
                  ? "Products ready; syncing updates"
                : templates.length === 1
                  ? "product available"
                  : "products available"}
            </span>
          </div>
        </div>
      </m.section>

      <section aria-labelledby="catalog-heading" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Available products
            </p>
            <h2
              id="catalog-heading"
              className="scroll-mt-24 text-2xl font-semibold tracking-tight"
            >
              Template library
            </h2>
          </div>
          <Badge variant="outline" className="bg-surface">
            {templates.length} {templates.length === 1 ? "template" : "templates"}
          </Badge>
        </div>

        {catalogStatus === "degraded" ? (
          <Alert>
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>Some catalog updates could not be loaded</AlertTitle>
            <AlertDescription>
              The available checked-in products are still ready to use. Refresh later to retry the
              live catalog.
            </AlertDescription>
          </Alert>
        ) : null}

        {templates.length ? (
          <m.div
            initial="hidden"
            animate="visible"
            variants={listRevealVariants}
                  className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            <AnimatePresence initial={false}>
              {templates.map((template, index) => (
                <m.article
                  key={template.slug}
                  variants={listItemVariants}
                  exit="exit"
                  className="[contain-intrinsic-size:auto_32rem] [content-visibility:auto]"
                >
                  <Card asChild interactive className="h-full gap-0 py-0">
                    <Link
                      href={getMockupHref(template.slug)}
                      aria-label={`Open ${template.name} mockup workspace`}
                    >
                      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-border bg-muted/55 p-5">
                        <img
                          src={template.baseImageUrl}
                          alt={template.name}
                          width={1200}
                          height={900}
                          loading={index === 0 ? "eager" : "lazy"}
                          fetchPriority={index === 0 ? "high" : "auto"}
                          decoding="async"
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <CardHeader className="flex-1 gap-3 py-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant="secondary">{template.category}</Badge>
                          {template.size ? (
                            <Badge variant="outline">{template.size}</Badge>
                          ) : null}
                        </div>
                        <CardTitle asChild>
                          <h3>{template.name}</h3>
                        </CardTitle>
                        <CardDescription className="line-clamp-3 leading-relaxed">
                          {template.description}
                        </CardDescription>
                      </CardHeader>
                      <CardFooter className="justify-between gap-3 text-sm font-semibold">
                        <span>Open mockup workspace</span>
                        <ArrowUpRightIcon aria-hidden="true" />
                      </CardFooter>
                    </Link>
                  </Card>
                </m.article>
              ))}
            </AnimatePresence>
          </m.div>
        ) : catalogStatus === "loading" ? (
          <CatalogSkeleton />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpenIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No product templates found</EmptyTitle>
              <EmptyDescription>
                Add a checked-in product with <code>npm run add:product -- ...</code> or publish one
                from Local Studio.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </ApplicationShell>
  );
}
