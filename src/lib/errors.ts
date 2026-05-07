import { NextResponse } from "next/server";

export type ErrorCode =
  | "MISSING_GEMINI_API_KEY"
  | "REAL_AI_REQUIRED"
  | "PRODUCT_TEMPLATE_NOT_FOUND"
  | "MISSING_BASE_IMAGE"
  | "MISSING_INSTRUCTION_IMAGE"
  | "PLACEHOLDER_ASSET_DETECTED"
  | "INVALID_TEMPLATE_ASSET"
  | "INVALID_PANTONE"
  | "INVALID_PRINTING_METHOD"
  | "INVALID_LOGO_PRINT_COLOR"
  | "INVALID_LOGO_FILE"
  | "LOGO_FILE_TOO_LARGE"
  | "AI_QUOTA_EXCEEDED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_NETWORK_ERROR"
  | "AI_NO_IMAGE_RETURNED"
  | "AI_GENERATION_TIMEOUT"
  | "AI_GENERATION_FAILED"
  | "INVALID_FORM_DATA";

export class AppError extends Error {
  constructor(
    public readonly errorCode: ErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

const defaultMessages: Record<ErrorCode, string> = {
  MISSING_GEMINI_API_KEY:
    "Gemini API key is missing in the server runtime. Configure GEMINI_API_KEY in Netlify environment variables with Functions scope before generating real mockups.",
  REAL_AI_REQUIRED:
    "Real Gemini image generation is required. Disable stub mode and configure GEMINI_API_KEY.",
  PRODUCT_TEMPLATE_NOT_FOUND: "The product template could not be found.",
  MISSING_BASE_IMAGE:
    "The product template image could not be found. Please check the product assets.",
  MISSING_INSTRUCTION_IMAGE:
    "The instruction image could not be found. Please check the product template.",
  PLACEHOLDER_ASSET_DETECTED:
    "Placeholder, demo, starter, or sample template asset detected. Please replace it with a real product asset.",
  INVALID_TEMPLATE_ASSET:
    "The product template asset is invalid. Please check the file type, dimensions, and image integrity.",
  INVALID_PANTONE: "The selected Pantone color is not available for this product.",
  INVALID_PRINTING_METHOD:
    "The selected printing method is not available for this product.",
  INVALID_LOGO_PRINT_COLOR:
    "The selected logo print color is not available for this product.",
  INVALID_LOGO_FILE: "Please upload a valid logo file.",
  LOGO_FILE_TOO_LARGE: "This logo file is too large.",
  AI_QUOTA_EXCEEDED:
    "Gemini image model quota is exhausted or unavailable for this API project. Please check Gemini billing and quota settings.",
  AI_MODEL_UNAVAILABLE:
    "Gemini image model is currently busy or unavailable. Please try again later.",
  AI_NETWORK_ERROR:
    "The Gemini connection closed before the image was returned. Please try again.",
  AI_NO_IMAGE_RETURNED:
    "Gemini responded but did not return an image. Please check the model response details and prompt.",
  AI_GENERATION_TIMEOUT:
    "Gemini accepted the generation job, but it did not finish in time. Please try again later.",
  AI_GENERATION_FAILED:
    "We could not generate the mockup. Please try again or contact Chili.",
  INVALID_FORM_DATA: "Please complete all required mockup fields."
};

export function toErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        success: false,
        errorCode: error.errorCode,
        error: error.message || defaultMessages[error.errorCode]
      },
      { status: error.statusCode }
    );
  }

  console.error(error);

  return NextResponse.json(
    {
      success: false,
      errorCode: "AI_GENERATION_FAILED",
      error: defaultMessages.AI_GENERATION_FAILED
    },
    { status: 500 }
  );
}
