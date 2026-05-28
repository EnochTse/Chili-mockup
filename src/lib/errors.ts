import { NextResponse } from "next/server";

export type ErrorCode =
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
  | "INVALID_FORM_DATA"
  | "INTERNAL_SERVER_ERROR";

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
  INVALID_FORM_DATA: "Please complete all required mockup fields.",
  INTERNAL_SERVER_ERROR: "Something went wrong while processing the request."
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
      errorCode: "INTERNAL_SERVER_ERROR",
      error: defaultMessages.INTERNAL_SERVER_ERROR
    },
    { status: 500 }
  );
}
