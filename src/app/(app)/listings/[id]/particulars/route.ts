import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { renderParticularsPdf } from "@/lib/pdf/build-particulars";

// react-pdf and the bundled TTFs need the Node runtime (not Edge).
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isDbConfigured) return new Response("Not found", { status: 404 });
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return new Response("Not found", { status: 404 });

  const pdf = await renderParticularsPdf(agencyId, id);
  if (!pdf) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
