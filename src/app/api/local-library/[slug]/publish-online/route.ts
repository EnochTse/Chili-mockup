import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertLocalStudioRequest } from "@/lib/services/local-library.service";
import { publishLocalProductOnline } from "@/lib/services/online-publish.service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    assertLocalStudioRequest(request);
    const { slug } = await context.params;
    return NextResponse.json(await publishLocalProductOnline(slug));
  } catch (error) {
    return toErrorResponse(error);
  }
}
