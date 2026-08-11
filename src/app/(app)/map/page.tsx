import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConcentrationMap } from "@/components/concentration-map-lazy";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getMapLayers } from "@/lib/db/queries/map-points";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage() {
  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const agencyId = await currentAgencyId(session.user.id);
  const layers = agencyId
    ? await getMapLayers(agencyId)
    : { listings: [], companies: [], contacts: [] };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Location map</h1>
        <p className="text-sm text-muted-foreground">
          Where your listings, companies and contacts are across the UK.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>
            Every geocoded record, pinned on the map. Click a pin for its card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConcentrationMap layers={layers} />
        </CardContent>
      </Card>
    </div>
  );
}
