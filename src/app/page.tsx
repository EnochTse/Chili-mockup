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
