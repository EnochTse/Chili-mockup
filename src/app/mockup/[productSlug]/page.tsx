import MockupGenerator from "@/components/mockup-generator";
import {
  listTemplateSlugs,
  listTemplateSummaries,
  loadTemplate,
  toTemplatePublicDto
} from "@/lib/services/template.service";

export const dynamicParams = false;

export async function generateStaticParams() {
  const productSlugs = await listTemplateSlugs();
  return productSlugs.map((productSlug) => ({ productSlug }));
}

export default async function MockupPage({
  params
}: {
  params: Promise<{ productSlug: string }>;
}) {
  const { productSlug } = await params;
  const [template, availableTemplates] = await Promise.all([
    loadTemplate(productSlug),
    listTemplateSummaries()
  ]);

  return (
    <MockupGenerator
      productSlug={productSlug}
      initialTemplate={toTemplatePublicDto(template)}
      availableTemplates={availableTemplates}
    />
  );
}
