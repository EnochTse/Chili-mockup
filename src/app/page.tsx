import Link from "next/link";
import ChiliLogo from "@/components/chili-logo";
import { listTemplateSummaries } from "@/lib/services/template.service";

export default async function HomePage() {
  const templates = await listTemplateSummaries();
  const firstTemplate = templates[0] || null;

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="brand-lockup">
          <ChiliLogo className="brand-logo" />
        </div>
        <div className="site-bar-actions">
          <Link href="/setup" className="secondary-link-button">
            Setup studio
          </Link>
          <span className="mode-pill">Template library</span>
        </div>
      </header>

      <section className="catalog-hero">
        <div className="hero-copy-stack">
          <p className="eyebrow">Chili workflow</p>
          <h1 className="hero-title">Choose a product and build a faster mockup review flow</h1>
          <p className="hero-support">
            Start from a prepared product template, configure Pantone parts, upload the client
            logo, and review a realistic mockup before handing it to the design team.
          </p>
          <div className="hero-action-row">
            {firstTemplate ? (
              <Link
                href={`/mockup/${firstTemplate.slug}`}
                className="button-primary hero-link-button"
              >
                Open first mockup
              </Link>
            ) : null}
            <Link href="/setup" className="secondary-link-button">
              Manage template setup
            </Link>
          </div>
        </div>

        <div className="hero-aside-stack">
          <div className="notice-panel">
            <strong>Visual reference only.</strong> Every generated image must still be reviewed
            by Chili for final artwork, print method, and production feasibility.
          </div>

          <div className="hero-stat-grid" aria-label="Library overview">
            <article className="stat-card">
              <span className="stat-label">Templates</span>
              <strong className="stat-value">{templates.length}</strong>
              <p className="stat-copy">Ready-to-use product entries in the current library.</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">Workflow</span>
              <strong className="stat-value">3 steps</strong>
              <p className="stat-copy">Pick product, configure print details, then review output.</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">Setup mode</span>
              <strong className="stat-value">Local + Netlify</strong>
              <p className="stat-copy">Maintain templates in setup studio and deploy from GitHub.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="workflow-strip" aria-label="How the tool works">
        <article className="workflow-step-card">
          <span className="workflow-step-index">01</span>
          <div>
            <h2 className="workflow-step-title">Pick a template</h2>
            <p className="workflow-step-copy">
              Start with a product that already has a base image and instruction image.
            </p>
          </div>
        </article>
        <article className="workflow-step-card">
          <span className="workflow-step-index">02</span>
          <div>
            <h2 className="workflow-step-title">Configure print details</h2>
            <p className="workflow-step-copy">
              Choose Pantone colors, finish options, logo color, and printing method.
            </p>
          </div>
        </article>
        <article className="workflow-step-card">
          <span className="workflow-step-index">03</span>
          <div>
            <h2 className="workflow-step-title">Review and export</h2>
            <p className="workflow-step-copy">
              Inspect the preview, adjust logo placement locally, then save the reference.
            </p>
          </div>
        </article>
      </section>

      <section className="section-heading-row">
        <div>
          <p className="panel-kicker">Available products</p>
          <h2 className="section-title">Template library</h2>
        </div>
        <p className="section-caption">
          Each card opens a dedicated mockup workspace with the correct asset pair and rules.
        </p>
      </section>

      {templates.length ? (
        <section className="catalog-grid">
          {templates.map((template) => (
            <Link
              key={template.slug}
              href={`/mockup/${template.slug}`}
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
                    →
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
