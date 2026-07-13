import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sanitizeText(input: string): string {
  if (!input) return '';
  // Strip all HTML tags
  let cleaned = input.replace(/<[^>]*>/g, '');
  // Escape potential HTML characters for XSS prevention
  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
  return cleaned.trim();
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
    month: 'short',
    day: 'numeric',
  });
}

export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

export function parseGoogleMapsLink(url: string): { lat: number; lng: number; name?: string } | null {
  try {
    const decodedUrl = decodeURIComponent(url);

    // 1. Check for @latitude,longitude format
    const atRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const atMatch = decodedUrl.match(atRegex);
    if (atMatch) {
      return {
        lat: parseFloat(atMatch[1]),
        lng: parseFloat(atMatch[2]),
        name: extractPlaceName(decodedUrl),
      };
    }

    // 2. Check for query parameters like q=lat,lng or query=lat,lng or ll=lat,lng
    const queryRegex = /[?&](q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/;
    const queryMatch = decodedUrl.match(queryRegex);
    if (queryMatch) {
      return {
        lat: parseFloat(queryMatch[2]),
        lng: parseFloat(queryMatch[3]),
        name: extractPlaceName(decodedUrl),
      };
    }

    // 3. Check search/lat,lng
    const searchRegex = /search\/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
    const searchMatch = decodedUrl.match(searchRegex);
    if (searchMatch) {
      return {
        lat: parseFloat(searchMatch[1]),
        lng: parseFloat(searchMatch[2]),
        name: extractPlaceName(decodedUrl),
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

function extractPlaceName(url: string): string | undefined {
  try {
    const placeRegex = /\/place\/([^/]+)/;
    const match = url.match(placeRegex);
    if (match) {
      return match[1].replace(/\+/g, ' ');
    }
  } catch (e) {}
  return undefined;
}

export function optimizeRouteStops<T extends { latitude: number; longitude: number }>(stops: T[]): T[] {
  if (stops.length <= 2) return stops;

  const optimized: T[] = [stops[0]]; // Start point (school) remains at index 0
  const unvisited = [...stops.slice(1)];

  let current = stops[0];
  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = getDistanceMeters(
        current.latitude,
        current.longitude,
        unvisited[i].latitude,
        unvisited[i].longitude
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    current = unvisited[nearestIdx];
    optimized.push(current);
    unvisited.splice(nearestIdx, 1);
  }

  return optimized;
}
