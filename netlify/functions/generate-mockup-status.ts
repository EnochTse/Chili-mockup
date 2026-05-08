import { AppError } from "../../src/lib/errors";
import { createAiProvider } from "../../src/lib/services/ai.service";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}

function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return jsonResponse(
      {
        success: false,
        errorCode: error.errorCode,
        error: error.message
      },
      error.statusCode
    );
  }

  console.error(error);

  return jsonResponse(
    {
      success: false,
      errorCode: "AI_GENERATION_FAILED",
      error: "We could not read the mockup job status. Please try again or contact Chili."
    },
    500
  );
}

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        errorCode: "INVALID_FORM_DATA",
        error: "Use POST to check a mockup job."
      },
      405
    );
  }

  try {
    const body = await request.json();
    const jobName = typeof body?.jobName === "string" ? body.jobName : "";
    const productSlug = typeof body?.productSlug === "string" ? body.productSlug : "";

    if (!jobName || !productSlug || !slugPattern.test(productSlug)) {
      throw new AppError("INVALID_FORM_DATA", "Invalid mockup job status request.", 400);
    }

    const result = await createAiProvider().getMockupJobStatus(jobName, productSlug);

    return jsonResponse({
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
    return errorResponse(error);
  }
}
