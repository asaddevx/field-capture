import * as Location from 'expo-location';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

const toFix = (l: Location.LocationObject): Fix => ({
  latitude: l.coords.latitude,
  longitude: l.coords.longitude,
  accuracy: l.coords.accuracy ?? null,
});

/**
 * GPS works without a data connection, but a cold fix can be slow. Return a
 * recent cached fix immediately when available, otherwise wait (bounded) for a
 * fresh one.
 */
export async function getFix(timeoutMs = 15_000): Promise<Fix | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;

  const cached = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 100 });
  if (cached) return toFix(cached);

  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(toFix);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([fresh, timeout]).catch(() => null);
}
