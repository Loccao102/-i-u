import "server-only";

import {
  getGooglePlaceLiveDetails,
  isGooglePlacesConfigured,
  resolveGooglePlaceId
} from "./google-places";
import {
  getPersonalPlace,
  setGooglePlaceId
} from "./personal-repository";
import { listUserPlacePhotos } from "./place-photo-repository";
import type { PlaceMedia } from "../types";

export async function getPlaceMedia(
  ownerKey: string,
  placeId: string
): Promise<PlaceMedia | null> {
  const place = await getPersonalPlace(ownerKey, placeId);
  if (!place) return null;

  const userPhotosPromise = listUserPlacePhotos(ownerKey, placeId);
  const googleConfigured = isGooglePlacesConfigured();

  let googlePlaceId = place.googlePlaceId ?? null;

  if (!googlePlaceId && googleConfigured) {
    googlePlaceId = await resolveGooglePlaceId(place);

    if (googlePlaceId) {
      try {
        await setGooglePlaceId(ownerKey, placeId, googlePlaceId);
      } catch {
        // Another saved place may already own the same Google place ID.
        // The live media can still be shown without persisting the match.
      }
    }
  }

  const [userPhotos, google] = await Promise.all([
    userPhotosPromise,
    googlePlaceId
      ? getGooglePlaceLiveDetails(googlePlaceId)
      : Promise.resolve(null)
  ]);

  return {
    userPhotos,
    google,
    googleConfigured
  };
}
