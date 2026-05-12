"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import ChiliLogo from "@/components/chili-logo";
import {
  productFinishLabels,
  productFinishOptions,
  resolvePartDefaultFinish
} from "@/lib/services/finish-option.service";
import type {
  PartIndicatorAnchor,
  ProductColorPart,
  ProductFinishOption,
  ProductSpecification,
  TemplatePublicDto
} from "@/lib/types";

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
    partMaskImageFileName: "",
    defaultPantoneCode: "Pantone Black C",
    indicatorAnchors: [createDraftIndicatorAnchor(index, 1)]
  };
}

function createDraftIndicatorAnchor(partIndex: number, anchorIndex: number): PartIndicatorAnchor {
  return {
    id: `part-${partIndex}-indicator-${anchorIndex}-${Math.random().toString(36).slice(2, 8)}`,
    targetXPercent: 50,
    targetYPercent: 50,
    labelOffsetXPercent: anchorIndex % 2 === 1 ? 18 : -18,
    labelOffsetYPercent: -12
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
    colorParts: template.colorParts.length
      ? template.colorParts.map((part, index) => ({
          ...part,
          indicatorAnchors:
            part.indicatorAnchors?.length
              ? part.indicatorAnchors
              : [createDraftIndicatorAnchor(index + 1, 1)]
        }))
      : makeBlankFormState().colorParts,
    baseImageUrl: template.baseImageUrl,
    instructionImageUrl: template.instructionImageUrl,
    baseImageFile: null,
    instructionImageFile: null
  };
}

function updatePartAtIndex(
  colorParts: ProductColorPart[],
  index: number,
  updater: (part: ProductColorPart) => ProductColorPart
) {
  return colorParts.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

function toggleFinishOption(
  part: ProductColorPart,
  finish: ProductFinishOption
): ProductColorPart {
  const current = part.allowedFinishes || [];
  const nextAllowedFinishes = current.includes(finish)
    ? current.filter((item) => item !== finish)
    : [...current, finish];

  return {
    ...part,
    allowedFinishes: nextAllowedFinishes.length ? nextAllowedFinishes : undefined,
    defaultFinish: resolvePartDefaultFinish({
      allowedFinishes: nextAllowedFinishes,
      defaultFinish: part.defaultFinish
    })
  };
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function canSaveTemplateInCurrentEnvironment() {
  if (typeof window === "undefined") return true;

  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function buildIndicatorExportPayload(formState: EditorFormState) {
  return {
    slug: formState.slug,
    name: formState.name,
    colorParts: formState.colorParts.map((part) => ({
      id: part.id,
      label: part.label,
      indicatorAnchors: part.indicatorAnchors || []
    }))
  };
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error("Clipboard is not available in this browser.");
}

function downloadJsonFile(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function useResolvedAssetPreview(file: File | null, fallbackUrl: string) {
  const [previewUrl, setPreviewUrl] = useState(fallbackUrl);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(fallbackUrl);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, fallbackUrl]);

  return previewUrl;
}

function PartIndicatorVisualEditor({
  part,
  previewImageUrl,
  onAnchorChange
}: {
  part: ProductColorPart;
  previewImageUrl: string;
  onAnchorChange: (anchorIndex: number, next: Partial<PartIndicatorAnchor>) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(
    part.indicatorAnchors?.[0]?.id || null
  );
  const [dragState, setDragState] = useState<{
    anchorIndex: number;
    pointerId: number;
    mode: "target" | "label";
  } | null>(null);

  useEffect(() => {
    if (!part.indicatorAnchors?.length) {
      setActiveAnchorId(null);
      return;
    }

    const hasActiveAnchor = part.indicatorAnchors.some((anchor) => anchor.id === activeAnchorId);
    if (!hasActiveAnchor) {
      setActiveAnchorId(part.indicatorAnchors[0].id);
    }
  }, [activeAnchorId, part.indicatorAnchors]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;

    const updateSize = () => {
      const bounds = frame.getBoundingClientRect();
      setFrameSize({
        width: bounds.width,
        height: bounds.height
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [previewImageUrl]);

  useEffect(() => {
    if (!dragState) return;
    const currentDragState = dragState;

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== currentDragState.pointerId) return;

      const frame = frameRef.current;
      const anchor = part.indicatorAnchors?.[currentDragState.anchorIndex];
      if (!frame || !anchor) return;

      const bounds = frame.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const pointerXPercent = clampPercent(((event.clientX - bounds.left) / bounds.width) * 100);
      const pointerYPercent = clampPercent(((event.clientY - bounds.top) / bounds.height) * 100);

      if (currentDragState.mode === "target") {
        onAnchorChange(currentDragState.anchorIndex, {
          targetXPercent: roundToSingleDecimal(pointerXPercent),
          targetYPercent: roundToSingleDecimal(pointerYPercent)
        });
      } else {
        onAnchorChange(currentDragState.anchorIndex, {
          labelOffsetXPercent: roundToSingleDecimal(pointerXPercent - anchor.targetXPercent),
          labelOffsetYPercent: roundToSingleDecimal(pointerYPercent - anchor.targetYPercent)
        });
      }
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerId === currentDragState.pointerId) {
        setDragState(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragState, onAnchorChange, part.indicatorAnchors]);

  if (!previewImageUrl) {
    return (
      <div className="indicator-visual-empty">
        Upload or keep a product image to enable direct indicator positioning.
      </div>
    );
  }

  return (
    <div className="indicator-visual-editor">
      <div className="indicator-visual-head">
        <p className="fine-print">
          Drag the dot to place the target. Drag the pill label to place the callout.
        </p>
      </div>
      <div className="indicator-visual-frame" ref={frameRef}>
        <img src={previewImageUrl} alt={`${part.label} indicator preview`} />
        <div className="indicator-visual-overlay">
          {(part.indicatorAnchors || []).map((anchor, anchorIndex) => {
            const labelXPercent = clampPercent(
              anchor.targetXPercent + anchor.labelOffsetXPercent
            );
            const labelYPercent = clampPercent(
              anchor.targetYPercent + anchor.labelOffsetYPercent
            );
            const targetX = (frameSize.width * anchor.targetXPercent) / 100;
            const targetY = (frameSize.height * anchor.targetYPercent) / 100;
            const labelX = (frameSize.width * labelXPercent) / 100;
            const labelY = (frameSize.height * labelYPercent) / 100;
            const deltaX = targetX - labelX;
            const deltaY = targetY - labelY;
            const isActive = activeAnchorId === anchor.id;

            return (
              <div
                key={anchor.id}
                className={`indicator-visual-anchor${isActive ? " is-active" : ""}`}
              >
                <div
                  className="indicator-visual-line"
                  style={{
                    left: `${labelX}px`,
                    top: `${labelY}px`,
                    width: `${Math.hypot(deltaX, deltaY)}px`,
                    transform: `translateY(-50%) rotate(${(Math.atan2(deltaY, deltaX) * 180) / Math.PI}deg)`
                  }}
                />
                <button
                  type="button"
                  className="indicator-visual-target"
                  style={{
                    left: `${anchor.targetXPercent}%`,
                    top: `${anchor.targetYPercent}%`
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveAnchorId(anchor.id);
                    setDragState({
                      anchorIndex,
                      pointerId: event.pointerId,
                      mode: "target"
                    });
                  }}
                  aria-label={`Drag target for ${part.label} indicator ${anchorIndex + 1}`}
                />
                <button
                  type="button"
                  className="indicator-visual-label"
                  style={{
                    left: `${labelXPercent}%`,
                    top: `${labelYPercent}%`
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveAnchorId(anchor.id);
                    setDragState({
                      anchorIndex,
                      pointerId: event.pointerId,
                      mode: "label"
                    });
                  }}
                >
                  <span className="indicator-visual-label-number">{anchorIndex + 1}</span>
                  <span className="indicator-visual-label-copy">Drag callout</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
  const [partMaskFiles, setPartMaskFiles] = useState<Record<string, File | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const baseImagePreviewUrl = useResolvedAssetPreview(
    formState.baseImageFile,
    formState.baseImageUrl
  );
  const instructionImagePreviewUrl = useResolvedAssetPreview(
    formState.instructionImageFile,
    formState.instructionImageUrl
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.slug === selectedSlug) || null,
    [selectedSlug, templates]
  );
  const isNewTemplate = selectedSlug === newTemplateKey || !selectedTemplate;
  const canSaveTemplate = canSaveTemplateInCurrentEnvironment();
  const saveModeLabel = canSaveTemplate ? "Local save enabled" : "Preview only";

  function updateIndicatorAnchorField(
    partIndex: number,
    anchorIndex: number,
    next: Partial<PartIndicatorAnchor>
  ) {
    setFormState((current) => ({
      ...current,
      colorParts: updatePartAtIndex(current.colorParts, partIndex, (item) => ({
        ...item,
        indicatorAnchors: (item.indicatorAnchors || []).map((itemAnchor, itemAnchorIndex) =>
          itemAnchorIndex === anchorIndex ? { ...itemAnchor, ...next } : itemAnchor
        )
      }))
    }));
  }

  function selectTemplate(slug: string) {
    if (slug === newTemplateKey) {
      setSelectedSlug(newTemplateKey);
      setFormState(makeBlankFormState());
      setPartMaskFiles({});
      setSaveError(null);
      setSaveMessage(null);
      return;
    }

    const template = templates.find((candidate) => candidate.slug === slug);
    if (!template) return;

    setSelectedSlug(slug);
    setFormState(buildFormStateFromTemplate(template));
    setPartMaskFiles({});
    setSaveError(null);
    setSaveMessage(null);
  }

  function handlePartMaskFileChange(partId: string, file: File | null) {
    setPartMaskFiles((current) => ({
      ...current,
      [partId]: file
    }));
  }

  async function handleCopyAllIndicators() {
    try {
      await copyTextToClipboard(
        JSON.stringify(buildIndicatorExportPayload(formState), null, 2)
      );
      setSaveError(null);
      setSaveMessage("Indicator JSON copied to clipboard.");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to copy indicator JSON."
      );
      setSaveMessage(null);
    }
  }

  async function handleCopyPartIndicators(part: ProductColorPart) {
    try {
      await copyTextToClipboard(
        JSON.stringify(
          {
            id: part.id,
            label: part.label,
            indicatorAnchors: part.indicatorAnchors || []
          },
          null,
          2
        )
      );
      setSaveError(null);
      setSaveMessage(`${part.label} indicator JSON copied.`);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to copy part indicator JSON."
      );
      setSaveMessage(null);
    }
  }

  function handleExportIndicators() {
    try {
      const safeSlug = slugify(formState.slug || formState.name || "product");
      downloadJsonFile(
        `${safeSlug || "product"}-indicator-positions.json`,
        buildIndicatorExportPayload(formState)
      );
      setSaveError(null);
      setSaveMessage("Indicator JSON exported.");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to export indicator JSON."
      );
      setSaveMessage(null);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSaveTemplate) {
      setSaveError(
        "This Netlify setup page is preview-only. To save template files back into the repo, open Setup studio on local localhost."
      );
      setSaveMessage(null);
      return;
    }

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
      formState.colorParts.forEach((part, index) => {
        const partMaskFile = partMaskFiles[part.id];
        if (partMaskFile) {
          formData.append(`partMaskImage:${index}`, partMaskFile);
        }
      });

      const response = await fetch("/api/template-admin/save", {
        method: "POST",
        body: formData
      });
      const responseText = await response.text();
      let data: {
        success?: boolean;
        error?: string;
        template?: TemplatePublicDto;
      } = {};

      if (responseText) {
        try {
          data = JSON.parse(responseText) as typeof data;
        } catch {
          if (responseText.trim().startsWith("<")) {
            throw new Error(
              "This deployment does not expose the template save API. Netlify branch deploy can preview indicator editing, but saving to the repo works on local localhost only."
            );
          }

          throw new Error("Save template returned non-JSON content. Please try again.");
        }
      }

      if (!response.ok || !data.success || !data.template) {
        throw new Error(data.error || "Failed to save the product template.");
      }

      const savedTemplate = data.template as TemplatePublicDto;
      const nextTemplates = [...templates.filter((template) => template.slug !== savedTemplate.slug), savedTemplate]
        .sort((left, right) => left.name.localeCompare(right.name));

      setTemplates(nextTemplates);
      setSelectedSlug(savedTemplate.slug);
      setFormState(buildFormStateFromTemplate(savedTemplate));
      setPartMaskFiles({});
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
        <div className="hero-copy-stack">
          <p className="eyebrow">Setup studio</p>
          <h1 className="hero-title">Configure product templates in the UI</h1>
          <p className="hero-support">
            Maintain template metadata, product parts, finish options, instruction anchors, and
            asset pairs from one editor before pushing the result back to GitHub.
          </p>
        </div>
        <div className="hero-aside-stack">
          <div className="notice-panel">
            This editor updates local template files, product images, and instruction images inside
            the current workspace.
          </div>
          <div className="hero-stat-grid" aria-label="Setup overview">
            <article className="stat-card">
              <span className="stat-label">Templates</span>
              <strong className="stat-value">{templates.length}</strong>
              <p className="stat-copy">Products currently available in the local template library.</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">Current mode</span>
              <strong className="stat-value stat-value-compact">{saveModeLabel}</strong>
              <p className="stat-copy">
                {canSaveTemplate
                  ? "Changes can be saved back into workspace files."
                  : "Branch deploy can preview edits, but saving is disabled."}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">Selected parts</span>
              <strong className="stat-value">{formState.colorParts.length}</strong>
              <p className="stat-copy">Color-controlled areas in the active template draft.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="workflow-strip" aria-label="Setup workflow">
        <article className="workflow-step-card">
          <span className="workflow-step-index">01</span>
          <div>
            <h2 className="workflow-step-title">Define the template</h2>
            <p className="workflow-step-copy">
              Set the product slug, name, category, description, and size so the library stays clear.
            </p>
          </div>
        </article>
        <article className="workflow-step-card">
          <span className="workflow-step-index">02</span>
          <div>
            <h2 className="workflow-step-title">Map parts and indicators</h2>
            <p className="workflow-step-copy">
              Describe recolorable regions, allowed finishes, and visual callouts on the base image.
            </p>
          </div>
        </article>
        <article className="workflow-step-card">
          <span className="workflow-step-index">03</span>
          <div>
            <h2 className="workflow-step-title">Save and test</h2>
            <p className="workflow-step-copy">
              Update local template files, then reopen the product mockup page to verify the flow.
            </p>
          </div>
        </article>
      </section>

      <section className="section-heading-row">
        <div>
          <p className="panel-kicker">Template workspace</p>
          <h2 className="section-title">Manage product setup</h2>
        </div>
        <p className="section-caption">
          Keep the list on the left for navigation and use the main form to edit the active template.
        </p>
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
            <div className="notice-panel sidebar-note-panel">
              <strong>Recommended flow</strong>
              <br />
              Create or select a template, edit parts and indicators, save locally, then open the
              mockup page to validate the final operator experience.
            </div>
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
            <div className="setup-inline-actions">
              <span className={`status-pill${canSaveTemplate ? " is-complete" : ""}`}>
                {saveModeLabel}
              </span>
              <span className="status-pill">{isNewTemplate ? "Draft template" : "Existing template"}</span>
            </div>
            {!canSaveTemplate ? (
              <p className="fine-print">
                This Netlify setup page is preview-only. Save template works on local localhost.
              </p>
            ) : null}
            <div className="setup-inline-actions">
              <button
                type="button"
                className="secondary-link-button"
                onClick={handleCopyAllIndicators}
              >
                Copy indicator JSON
              </button>
              <button
                type="button"
                className="secondary-link-button"
                onClick={handleExportIndicators}
              >
                Export indicators JSON
              </button>
            </div>
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

                      <label className="setup-field">
                        <span className="control-label">Part mask image file</span>
                        <input
                          className="input-shell"
                          value={part.partMaskImageFileName || ""}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              colorParts: current.colorParts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, partMaskImageFileName: event.target.value }
                                  : item
                              )
                            }))
                          }
                          placeholder="part-1-mask.png"
                        />
                      </label>
                    </div>
                    <p className="fine-print">
                      Optional. Add a per-part mask image file name stored in
                      {` `}
                      <code>{`/public/mockup-templates/${formState.slug || "<slug>"}/`}</code>
                      {` `}
                      to give Gemini an isolated location reference for this exact part.
                    </p>
                    <div className="setup-inline-actions">
                      <label className="secondary-link-button" htmlFor={`partMaskUpload-${part.id}`}>
                        Upload mask image
                      </label>
                      <input
                        id={`partMaskUpload-${part.id}`}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          handlePartMaskFileChange(part.id, file);
                          event.currentTarget.value = "";
                        }}
                      />
                      {partMaskFiles[part.id] ? (
                        <button
                          type="button"
                          className="secondary-link-button"
                          onClick={() => handlePartMaskFileChange(part.id, null)}
                        >
                          Clear pending mask
                        </button>
                      ) : null}
                    </div>
                    {partMaskFiles[part.id] ? (
                      <p className="fine-print">Pending mask upload: {partMaskFiles[part.id]?.name}</p>
                    ) : part.partMaskImageFileName ? (
                      <p className="fine-print">Current mask asset: {part.partMaskImageFileName}</p>
                    ) : null}

                    <div className="setup-subsection">
                      <div className="setup-subsection-head">
                        <div>
                          <span className="control-label">Material finish options</span>
                          <p className="fine-print">
                            Turn on only the finishes that this exact product part can offer.
                          </p>
                        </div>
                      </div>

                      <div className="quick-choice-row" aria-label={`${part.label} finish options`}>
                        {productFinishOptions.map((finish) => {
                          const isActive = part.allowedFinishes?.includes(finish) || false;

                          return (
                            <button
                              key={`${part.id}-${finish}`}
                              type="button"
                              className={`quick-choice-button${isActive ? " is-active" : ""}`}
                              onClick={() =>
                                setFormState((current) => ({
                                  ...current,
                                  colorParts: updatePartAtIndex(current.colorParts, index, (item) =>
                                    toggleFinishOption(item, finish)
                                  )
                                }))
                              }
                            >
                              {productFinishLabels[finish]}
                            </button>
                          );
                        })}
                      </div>

                      {part.allowedFinishes?.length ? (
                        <label className="setup-field finish-default-field">
                          <span className="control-label">Default finish</span>
                          <select
                            className="input-shell"
                            value={part.defaultFinish || resolvePartDefaultFinish(part) || ""}
                            onChange={(event) =>
                              setFormState((current) => ({
                                ...current,
                                colorParts: updatePartAtIndex(current.colorParts, index, (item) => ({
                                  ...item,
                                  defaultFinish: (event.target.value || undefined) as
                                    | ProductFinishOption
                                    | undefined
                                }))
                              }))
                            }
                          >
                            <option value="">Select default finish</option>
                            {part.allowedFinishes.map((finish) => (
                              <option key={`${part.id}-default-${finish}`} value={finish}>
                                {productFinishLabels[finish]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>

                    <div className="setup-subsection">
                      <div className="setup-subsection-head">
                        <div>
                          <span className="control-label">Part indicators</span>
                          <p className="fine-print">
                            Add 1 to 3 arrow targets for the big preview image. Use percentages so
                            the callouts stay aligned responsively.
                          </p>
                        </div>
                        <div className="setup-inline-actions">
                          <button
                            type="button"
                            className="secondary-link-button"
                            onClick={() => handleCopyPartIndicators(part)}
                          >
                            Copy part JSON
                          </button>
                          <button
                            type="button"
                            className="secondary-link-button"
                            disabled={(part.indicatorAnchors?.length || 0) >= 3}
                            onClick={() =>
                              setFormState((current) => ({
                                ...current,
                                colorParts: updatePartAtIndex(current.colorParts, index, (item) => ({
                                  ...item,
                                  indicatorAnchors: [
                                    ...(item.indicatorAnchors || []),
                                    createDraftIndicatorAnchor(
                                      index + 1,
                                      (item.indicatorAnchors?.length || 0) + 1
                                    )
                                  ]
                                }))
                              }))
                            }
                          >
                            Add indicator
                          </button>
                        </div>
                      </div>

                      <PartIndicatorVisualEditor
                        part={part}
                        previewImageUrl={baseImagePreviewUrl}
                        onAnchorChange={(anchorIndex, next) =>
                          updateIndicatorAnchorField(index, anchorIndex, next)
                        }
                      />

                      <div className="indicator-anchor-stack">
                        {(part.indicatorAnchors || []).map((anchor, anchorIndex) => (
                          <div key={anchor.id} className="indicator-anchor-card">
                            <div className="indicator-anchor-head">
                              <p className="indicator-anchor-title">
                                Indicator {anchorIndex + 1}
                              </p>
                              <button
                                type="button"
                                className="secondary-link-button"
                                disabled={(part.indicatorAnchors?.length || 0) <= 1}
                                onClick={() =>
                                  setFormState((current) => ({
                                    ...current,
                                    colorParts: updatePartAtIndex(
                                      current.colorParts,
                                      index,
                                      (item) => ({
                                        ...item,
                                        indicatorAnchors:
                                          (item.indicatorAnchors || []).length > 1
                                            ? (item.indicatorAnchors || []).filter(
                                                (_, itemAnchorIndex) =>
                                                  itemAnchorIndex !== anchorIndex
                                              )
                                            : item.indicatorAnchors
                                      })
                                    )
                                  }))
                                }
                              >
                                Remove
                              </button>
                            </div>

                            <div className="field-grid indicator-anchor-grid">
                              <label className="setup-field">
                                <span className="control-label">Target X %</span>
                                <input
                                  className="input-shell"
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  value={anchor.targetXPercent}
                                  onChange={(event) =>
                                    updateIndicatorAnchorField(index, anchorIndex, {
                                      targetXPercent: Number(event.target.value || 0)
                                    })
                                  }
                                />
                              </label>

                              <label className="setup-field">
                                <span className="control-label">Target Y %</span>
                                <input
                                  className="input-shell"
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  value={anchor.targetYPercent}
                                  onChange={(event) =>
                                    updateIndicatorAnchorField(index, anchorIndex, {
                                      targetYPercent: Number(event.target.value || 0)
                                    })
                                  }
                                />
                              </label>

                              <label className="setup-field">
                                <span className="control-label">Label offset X %</span>
                                <input
                                  className="input-shell"
                                  type="number"
                                  min="-100"
                                  max="100"
                                  step="0.1"
                                  value={anchor.labelOffsetXPercent}
                                  onChange={(event) =>
                                    updateIndicatorAnchorField(index, anchorIndex, {
                                      labelOffsetXPercent: Number(event.target.value || 0)
                                    })
                                  }
                                />
                              </label>

                              <label className="setup-field">
                                <span className="control-label">Label offset Y %</span>
                                <input
                                  className="input-shell"
                                  type="number"
                                  min="-100"
                                  max="100"
                                  step="0.1"
                                  value={anchor.labelOffsetYPercent}
                                  onChange={(event) =>
                                    updateIndicatorAnchorField(index, anchorIndex, {
                                      labelOffsetYPercent: Number(event.target.value || 0)
                                    })
                                  }
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
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
                  {baseImagePreviewUrl ? (
                    <div className="catalog-image-frame compact-frame">
                      <img src={baseImagePreviewUrl} alt="Current product asset" />
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
                  {instructionImagePreviewUrl ? (
                    <div className="catalog-image-frame compact-frame">
                      <img src={instructionImagePreviewUrl} alt="Current instruction asset" />
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
                <button
                  className="button-primary"
                  type="submit"
                  disabled={isSaving || !canSaveTemplate}
                  title={
                    canSaveTemplate
                      ? "Save template"
                      : "Save template is available on local localhost only"
                  }
                >
                  {isSaving ? "Saving..." : canSaveTemplate ? "Save template" : "Local save only"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
