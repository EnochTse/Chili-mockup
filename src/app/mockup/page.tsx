import { Suspense } from "react";
import LiveMockupRoute from "@/components/live-mockup-route";
import { listTemplateSummaries } from "@/lib/services/template.service";

export default async function LiveMockupPage() {
  const availableTemplates = await listTemplateSummaries();

  return (
    <Suspense fallback={<main className="mockup-page"><section className="surface notice-panel">Loading template...</section></main>}>
      <LiveMockupRoute availableTemplates={availableTemplates} />
    </Suspense>
  );
}
