import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { createAiProvider } from "@/lib/services/ai.service";

export const runtime = "nodejs";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const jobName = typeof body?.jobName === "string" ? body.jobName : "";
    const productSlug = typeof body?.productSlug === "string" ? body.productSlug : "";

    if (!jobName || !productSlug || !slugPattern.test(productSlug)) {
      throw new AppError("INVALID_FORM_DATA", "Invalid mockup job status request.", 400);
    }

    const result = await createAiProvider().getMockupJobStatus(jobName, productSlug);

    return NextResponse.json({
      success: true,
      completed: result.completed,
      jobName: result.jobName,
      state: result.state,
      imageUrl: result.imageUrl,
      provider: result.provider,
      model: result.model,
      stubMode: result.stubMode
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
