import TemplateSetupStudio from "@/components/template-setup-studio";
import { listTemplateSlugs, loadTemplate, toTemplatePublicDto } from "@/lib/services/template.service";

export default async function SetupPage() {
  const slugs = await listTemplateSlugs();
  const templates = await Promise.all(slugs.map((slug) => loadTemplate(slug)));

  return (
    <TemplateSetupStudio
      initialTemplates={templates.map((template) => toTemplatePublicDto(template))}
    />
  );
}
