"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
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

export default function TemplateLibraryHome({
  initialTemplates
}: TemplateLibraryHomeProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showLocalStudioLink, setShowLocalStudioLink] = useState(false);
  const [localPublishedSlugs, setLocalPublishedSlugs] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    let isCancelled = false;
    const localBrowser = isLocalStudioBrowser();
    setShowLocalStudioLink(localBrowser);

    async function loadPublishedCatalog() {
      let nextTemplates = initialTemplates;

      if (isLiveTemplateDatabaseConfigured()) {
        try {
          const liveTemplates = await listPublishedLiveTemplateSummaries(initialTemplates);
          nextTemplates = mergePublishedSummaries(nextTemplates, liveTemplates);
        } catch {
          // Keep checked-in products available while live data is temporarily unavailable.
        }
      }

      if (localBrowser) {
        try {
          const snapshot = await getLocalLibraryClientSnapshot();
          if (isCancelled) return;
          setLocalPublishedSlugs(
            new Set(snapshot.publishedSummaries.map((template) => template.slug))
          );
          nextTemplates = mergePublishedSummaries(
            nextTemplates,
            snapshot.publishedSummaries
          );
        } catch {
          // Local Studio may be disabled while the public catalog remains usable.
        }
      }

      if (!isCancelled) {
        setTemplates(nextTemplates);
      }
    }

    void loadPublishedCatalog();

    return () => {
      isCancelled = true;
    };
  }, [initialTemplates]);

  const firstTemplate = templates[0] || null;
  const checkedInSlugs = new Set(initialTemplates.map((template) => template.slug));

  function getMockupHref(slug: string) {
    return localPublishedSlugs.has(slug) || !checkedInSlugs.has(slug)
      ? `/mockup?slug=${encodeURIComponent(slug)}`
      : `/mockup/${slug}`;
  }

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="brand-lockup">
          <ChiliLogo className="brand-logo" />
        </div>
        <div className="site-bar-actions">
          {showLocalStudioLink ? (
            <Link href="/setup" className="secondary-link-button">
              Local Studio
            </Link>
          ) : null}
          <span className="mode-pill">Template library</span>
        </div>
      </header>

      <section className="catalog-hero">
        <div className="hero-copy-stack">
          <p className="eyebrow">Chili workflow</p>
          <h1 className="hero-title">Choose a product and build a faster mockup review flow</h1>
          <div className="hero-action-row">
            {firstTemplate ? (
              <Link
                href={getMockupHref(firstTemplate.slug)}
                className="button-primary hero-link-button"
              >
                Open first mockup
              </Link>
            ) : null}
            {showLocalStudioLink ? (
              <Link href="/setup" className="secondary-link-button">
                Manage local products
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section-heading-row">
        <div>
          <p className="panel-kicker">Available products</p>
          <h2 className="section-title">Template library</h2>
        </div>
      </section>

      {templates.length ? (
        <section className="catalog-grid">
          {templates.map((template) => (
            <Link
              key={template.slug}
              href={getMockupHref(template.slug)}
              className="catalog-card"
            >
              <div className="catalog-image-frame">
                <img src={template.baseImageUrl} alt={template.name} />
              </div>
              <div className="catalog-card-body">
                <div className="catalog-card-topline">
                  <p className="panel-kicker">{template.category}</p>
                  {template.size ? <span className="catalog-chip">{template.size}</span> : null}
                </div>
                <h2 className="section-title">{template.name}</h2>
                <p className="panel-description">{template.description}</p>
                <div className="catalog-card-footer">
                  <span className="catalog-link-copy">Open mockup workspace</span>
                  <span className="catalog-link-arrow" aria-hidden="true">
                    &rarr;
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      ) : (
        <section className="notice-panel">
          No product templates were found. Add one with `npm run add:product -- ...`
        </section>
      )}
    </main>
  );
}
