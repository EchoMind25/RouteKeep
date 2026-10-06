import "server-only";
import { env } from "@/lib/env";
import { googleGeocoder, manualGeocoder, type Geocoder } from "@/lib/providers/geocoder";

export function geocoder(): Geocoder {
  const key = env().GOOGLE_MAPS_API_KEY;
  return key ? googleGeocoder(key) : manualGeocoder;
}
