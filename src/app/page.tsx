import TemplateLibraryHome from "@/components/template-library-home";
import { listTemplateSummaries } from "@/lib/services/template.service";

export default async function HomePage() {
  const templates = await listTemplateSummaries();

  return <TemplateLibraryHome initialTemplates={templates} />;
}
