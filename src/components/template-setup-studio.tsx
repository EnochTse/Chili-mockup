"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
import type { ProductColorPart, ProductSpecification, TemplatePublicDto } from "@/lib/types";

type EditorFormState = {
  originalSlug: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  size: string;
  specifications: ProductSpecification[];
  colorParts: ProductColorPart[];
  baseImageUrl: string;
  instructionImageUrl: string;
  baseImageFile: File | null;
  instructionImageFile: File | null;
};

const newTemplateKey = "__new__";

function createDraftPart(index: number): ProductColorPart {
  return {
    id: `part-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Part ${index}`,
    description: `Color-controlled region ${index}.`,
    instructionCue: "",
    instructionColorHex: "",
    defaultPantoneCode: "Pantone Black C"
  };
}

function makeBlankFormState(): EditorFormState {
  return {
    originalSlug: "",
    slug: "",
    name: "",
    category: "",
    description: "",
    size: "",
    specifications: [{ label: "", value: "" }],
    colorParts: [
      {
        ...createDraftPart(1),
        description: "Primary recolorable area shown in the instruction image.",
      }
    ],
    baseImageUrl: "",
    instructionImageUrl: "",
    baseImageFile: null,
    instructionImageFile: null
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFormStateFromTemplate(template: TemplatePublicDto): EditorFormState {
  return {
    originalSlug: template.slug,
    slug: template.slug,
    name: template.name,
    category: template.category,
    description: template.description,
    size: template.size || "",
    specifications:
      template.specifications?.length ? template.specifications : [{ label: "", value: "" }],
    colorParts: template.colorParts.length ? template.colorParts : makeBlankFormState().colorParts,
    baseImageUrl: template.baseImageUrl,
    instructionImageUrl: template.instructionImageUrl,
    baseImageFile: null,
    instructionImageFile: null
  };
}

export default function TemplateSetupStudio({
  initialTemplates
}: {
  initialTemplates: TemplatePublicDto[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedSlug, setSelectedSlug] = useState(
    initialTemplates[0]?.slug || newTemplateKey
  );
  const [formState, setFormState] = useState<EditorFormState>(
    initialTemplates[0] ? buildFormStateFromTemplate(initialTemplates[0]) : makeBlankFormState()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.slug === selectedSlug) || null,
    [selectedSlug, templates]
  );
  const isNewTemplate = selectedSlug === newTemplateKey || !selectedTemplate;

  function selectTemplate(slug: string) {
    if (slug === newTemplateKey) {
      setSelectedSlug(newTemplateKey);
      setFormState(makeBlankFormState());
      setSaveError(null);
      setSaveMessage(null);
      return;
    }

    const template = templates.find((candidate) => candidate.slug === slug);
    if (!template) return;

    setSelectedSlug(slug);
    setFormState(buildFormStateFromTemplate(template));
    setSaveError(null);
    setSaveMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const formData = new FormData();
      formData.append("originalSlug", formState.originalSlug);
      formData.append("slug", formState.slug);
      formData.append("name", formState.name);
      formData.append("category", formState.category);
      formData.append("description", formState.description);
      formData.append("size", formState.size);
      formData.append("specifications", JSON.stringify(formState.specifications));
      formData.append("colorParts", JSON.stringify(formState.colorParts));
      if (formState.baseImageFile) {
        formData.append("baseImage", formState.baseImageFile);
      }
      if (formState.instructionImageFile) {
        formData.append("instructionImage", formState.instructionImageFile);
      }

      const response = await fetch("/api/template-admin/save", {
        method: "POST",
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !data.success || !data.template) {
        throw new Error(data.error || "Failed to save the product template.");
      }

      const savedTemplate = data.template as TemplatePublicDto;
      const nextTemplates = [...templates.filter((template) => template.slug !== savedTemplate.slug), savedTemplate]
        .sort((left, right) => left.name.localeCompare(right.name));

      setTemplates(nextTemplates);
      setSelectedSlug(savedTemplate.slug);
      setFormState(buildFormStateFromTemplate(savedTemplate));
      setSaveMessage("Product template saved locally.");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save the product template.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="setup-page">
      <header className="catalog-header">
        <div className="brand-lockup">
          <ChiliLogo className="brand-logo" />
        </div>
        <div className="site-bar-actions">
          <Link href="/" className="secondary-link-button">
            Product library
          </Link>
          <span className="mode-pill">Template setup</span>
        </div>
      </header>

      <section className="catalog-hero">
        <div>
          <p className="eyebrow">Setup studio</p>
          <h1 className="hero-title">Configure product templates in the UI</h1>
        </div>
        <div className="notice-panel">
          This editor updates local template files, product images, and instruction
          images inside the current workspace.
        </div>
      </section>

      <div className="setup-layout">
        <aside className="surface setup-sidebar">
          <div className="panel-head">
            <p className="panel-kicker">Products</p>
            <h2 className="section-title">Template list</h2>
          </div>
          <div className="setup-sidebar-body">
            <button
              type="button"
              className={`list-row-button${isNewTemplate ? " is-active" : ""}`}
              onClick={() => selectTemplate(newTemplateKey)}
            >
              New product
            </button>
            {templates.map((template) => (
              <button
                key={template.slug}
                type="button"
                className={`list-row-button${selectedSlug === template.slug ? " is-active" : ""}`}
                onClick={() => selectTemplate(template.slug)}
              >
                <span>{template.name}</span>
                <span className="list-row-meta">{template.category}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="surface setup-form-panel">
          <div className="panel-head">
            <p className="panel-kicker">{isNewTemplate ? "Create product" : "Edit product"}</p>
            <h2 className="section-title">
              {isNewTemplate ? "New template" : formState.name || formState.slug}
            </h2>
            {formState.slug ? (
              <p className="panel-description">Mockup URL: /mockup/{formState.slug}</p>
            ) : null}
          </div>

          <form className="setup-form" onSubmit={handleSubmit}>
            <div className="field-grid">
              <label className="setup-field">
                <span className="control-label">Product slug</span>
                <input
                  className="input-shell"
                  value={formState.slug}
                  disabled={!isNewTemplate}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, slug: slugify(event.target.value) }))
                  }
                  placeholder="umbrella-classic-black"
                />
              </label>

              <label className="setup-field">
                <span className="control-label">Product name</span>
                <input
                  className="input-shell"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Classic Umbrella"
                />
              </label>

              <label className="setup-field">
                <span className="control-label">Category</span>
                <input
                  className="input-shell"
                  value={formState.category}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, category: event.target.value }))
                  }
                  placeholder="umbrella"
                />
              </label>

              <label className="setup-field">
                <span className="control-label">Size</span>
                <input
                  className="input-shell"
                  value={formState.size}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, size: event.target.value }))
                  }
                  placeholder="Standard full-size canopy"
                />
              </label>
            </div>

            <label className="setup-field">
              <span className="control-label">Description</span>
              <textarea
                className="textarea-shell"
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, description: event.target.value }))
                }
                rows={4}
                placeholder="Describe the product and how the template should be used."
              />
            </label>

            <section className="setup-section">
              <div className="setup-section-head">
                <div>
                  <p className="panel-kicker">Description fields</p>
                  <h3 className="section-title">Specifications</h3>
                </div>
                <button
                  type="button"
                  className="secondary-link-button"
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      specifications: [...current.specifications, { label: "", value: "" }]
                    }))
                  }
                >
                  Add specification
                </button>
              </div>
              <div className="repeater-grid">
                {formState.specifications.map((specification, index) => (
                  <div key={`spec-${index}`} className="repeater-row">
                    <input
                      className="input-shell"
                      value={specification.label}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          specifications: current.specifications.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, label: event.target.value } : item
                          )
                        }))
                      }
                      placeholder="Label, e.g. Size"
                    />
                    <input
                      className="input-shell"
                      value={specification.value}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          specifications: current.specifications.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: event.target.value } : item
                          )
                        }))
                      }
                      placeholder="Value, e.g. 27 inch canopy"
                    />
                    <button
                      type="button"
                      className="secondary-link-button"
                      onClick={() =>
                        setFormState((current) => ({
                          ...current,
                          specifications:
                            current.specifications.length > 1
                              ? current.specifications.filter((_, itemIndex) => itemIndex !== index)
                              : [{ label: "", value: "" }]
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="setup-section">
              <div className="setup-section-head">
                <div>
                  <p className="panel-kicker">Color controls</p>
                  <h3 className="section-title">Recolorable parts</h3>
                  <p className="fine-print">
                    Add the exact cue used in the instruction image, such as a mask color,
                    callout label, or highlighted region name.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-link-button"
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      colorParts: [
                        ...current.colorParts,
                        createDraftPart(current.colorParts.length + 1)
                      ]
                    }))
                  }
                >
                  Add part
                </button>
              </div>
              <div className="part-stack">
                {formState.colorParts.map((part, index) => (
                  <div key={part.id || `part-${index}`} className="part-card">
                    <div className="field-grid">
                      <label className="setup-field">
                        <span className="control-label">Part label</span>
                        <input
                          className="input-shell"
                          value={part.label}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, label: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="Part 1"
                        />
                      </label>

                      <label className="setup-field">
                        <span className="control-label">Default Pantone</span>
                        <input
                          className="input-shell"
                          value={part.defaultPantoneCode || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, defaultPantoneCode: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="Pantone Black C"
                        />
                      </label>
                    </div>

                    <label className="setup-field">
                      <span className="control-label">Product area</span>
                      <textarea
                        className="textarea-shell"
                        value={part.description}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            colorParts: current.colorParts.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, description: event.target.value }
                                : item
                            )
                          }))
                        }
                        rows={3}
                        placeholder="Describe the real product area, e.g. Bottom bottle body"
                      />
                    </label>

                    <div className="field-grid">
                      <label className="setup-field">
                        <span className="control-label">Instruction cue</span>
                        <input
                          className="input-shell"
                          value={part.instructionCue || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, instructionCue: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="Blue lower bottle region"
                        />
                      </label>

                      <label className="setup-field">
                        <span className="control-label">Instruction overlay color</span>
                        <input
                          className="input-shell"
                          value={part.instructionColorHex || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, instructionColorHex: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="#1450FF"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="secondary-link-button"
                      onClick={() =>
                        setFormState((current) => ({
                          ...current,
                          colorParts:
                            current.colorParts.length > 1
                              ? current.colorParts.filter((_, itemIndex) => itemIndex !== index)
                              : current.colorParts
                        }))
                      }
                    >
                      Remove part
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="setup-section">
              <p className="panel-kicker">Assets</p>
              <h3 className="section-title">Product image and instruction image</h3>
              <div className="asset-upload-grid">
                <label className="setup-field">
                  <span className="control-label">Product image</span>
                  {formState.baseImageUrl ? (
                    <div className="catalog-image-frame compact-frame">
                      <img src={formState.baseImageUrl} alt="Current product asset" />
                    </div>
                  ) : null}
                  <input
                    className="input-shell"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        baseImageFile: event.target.files?.[0] || null
                      }))
                    }
                  />
                  {formState.baseImageFile ? (
                    <p className="fine-print">Pending file: {formState.baseImageFile.name}</p>
                  ) : null}
                </label>

                <label className="setup-field">
                  <span className="control-label">Instruction image</span>
                  {formState.instructionImageUrl ? (
                    <div className="catalog-image-frame compact-frame">
                      <img src={formState.instructionImageUrl} alt="Current instruction asset" />
                    </div>
                  ) : null}
                  <input
                    className="input-shell"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        instructionImageFile: event.target.files?.[0] || null
                      }))
                    }
                  />
                  {formState.instructionImageFile ? (
                    <p className="fine-print">
                      Pending file: {formState.instructionImageFile.name}
                    </p>
                  ) : null}
                </label>
              </div>
            </section>

            <div className="setup-footer">
              {saveError ? <p className="alert-error inline-alert">{saveError}</p> : null}
              {saveMessage ? <p className="success-message">{saveMessage}</p> : null}
              <div className="setup-footer-actions">
                {!isNewTemplate && formState.slug ? (
                  <Link href={`/mockup/${formState.slug}`} className="secondary-link-button">
                    Open mockup
                  </Link>
                ) : null}
                <button className="button-primary" type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save template"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
