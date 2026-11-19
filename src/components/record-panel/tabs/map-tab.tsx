import { EmptyNote, PanelSection } from "@/components/record-panel/fields";
import { LocationMap } from "@/components/location-map";

/** The record's pin. Only rendered while the Map tab is active, so Google Maps loads on demand. */
export function MapTab({
  lat,
  lng,
  label,
}: {
  lat: number | null;
  lng: number | null;
  label: string;
}) {
  return (
    <PanelSection title="Location">
      {lat != null && lng != null ? (
        <LocationMap lat={lat} lng={lng} label={label} />
      ) : (
        <EmptyNote>No location on this record yet.</EmptyNote>
      )}
    </PanelSection>
  );
}
