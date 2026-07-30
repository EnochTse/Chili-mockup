import TemplateSetupStudio from "@/components/template-setup-studio";
import { loadPantoneLibrary } from "@/lib/services/pantone-library.service";
import { listTemplateSummaries } from "@/lib/services/template.service";

export default async function SetupPage() {
  const templates = await listTemplateSummaries();

  return (
    <TemplateSetupStudio
      initialTemplates={templates}
      pantoneOptions={loadPantoneLibrary("pantone-solid-coated-v3")}
    />
  );
}
