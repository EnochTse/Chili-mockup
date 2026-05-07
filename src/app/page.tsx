import Link from "next/link";
import ChiliLogo from "@/components/chili-logo";
import { listTemplateSummaries } from "@/lib/services/template.service";

export default async function HomePage() {
  const templates = await listTemplateSummaries();

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
        <div>
          <p className="eyebrow">Available products</p>
          <h1 className="hero-title">Choose a product template</h1>
        </div>
        <div className="notice-panel">
          Each product template brings its own base image, instruction image, and
          mockup rules.
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
                <p className="panel-kicker">{template.category}</p>
                <h2 className="section-title">{template.name}</h2>
                <p className="panel-description">{template.description}</p>
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
