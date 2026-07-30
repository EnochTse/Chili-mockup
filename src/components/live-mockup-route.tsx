"use client";

import { useSearchParams } from "next/navigation";
import MockupGenerator from "@/components/mockup-generator";
import type { TemplateSummaryDto } from "@/lib/types";

type LiveMockupRouteProps = {
  availableTemplates: TemplateSummaryDto[];
};

export default function LiveMockupRoute({
  availableTemplates
}: LiveMockupRouteProps) {
  const searchParams = useSearchParams();
  const productSlug = searchParams.get("slug")?.trim() || "";
  const localChannel = searchParams.get("preview") === "latest" ? "latest" : "published";

  return (
    <MockupGenerator
      productSlug={productSlug}
      availableTemplates={availableTemplates}
      localChannel={localChannel}
    />
  );
}
