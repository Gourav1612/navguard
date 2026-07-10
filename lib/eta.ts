// Haversine formula to calculate distance between two coordinates in kilometers
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates estimated minutes remaining for a bus to reach a target stop.
 * Sums the distance from the bus's current location through intermediate route stops to the target stop.
 */
export function calculateETA(
  busLat: number,
  busLng: number,
  stops: Array<{ latitude: number; longitude: number; stop_order: number }>,
  targetStopOrder: number,
  avgSpeedKmh: number = 30
): number {
  if (stops.length === 0) return 0;

  // Filter stops that are between the current bus position and the target stop.
  // We assume the bus travels stops in order of stop_order.
  // We want stops with stop_order up to targetStopOrder.
  // But wait: if the bus has already passed some stops, where is it now?
  // We find the stop that the bus is closest to, or we assume it is moving towards the first stop
  // with stop_order larger than the ones it has passed.
  // Let's filter to stops that are part of the route up to the target stop (inclusive).
  
  // Find the next upcoming stop for the bus. To keep it simple and robust,
  // we filter stops that are >= the targetStopOrder and sort them by order.
  const remainingStops = stops
    .filter((s) => s.stop_order <= targetStopOrder)
    .sort((a, b) => a.stop_order - b.stop_order);

  if (remainingStops.length === 0) {
    // If target stop order is smaller than any route stop (e.g. school drop off at 0),
    // calculate direct distance.
    const directDist = getDistanceKm(busLat, busLng, stops[0].latitude, stops[0].longitude);
    return Math.max(1, Math.round((directDist / avgSpeedKmh) * 60));
  }

  // Find the closest stop in remainingStops to the bus, and start pathing from the bus to that stop, 
  // then forward to the target. Or we can just calculate direct distance from bus to target, 
  // plus sum of segments between intermediate stops.
  
  // segments distance sum:
  // segment 1: bus -> first upcoming stop
  // segment 2: stop N -> stop N+1 -> target stop
  
  // To avoid complex state tracking, we assume the bus segments towards the target stop.
  // If the bus is already near/at some stops, we sum distance starting from the bus's current location 
  // directly to the target stop if it is the next stop, or through the intermediate stops.
  
  // Find the stop in the route that has the minimum stop_order greater than or equal to current bus segment.
  // For safety, let's find the stops that are ahead of the bus. Since we don't know the exact last stop passed,
  // we can find the stop closest to the bus, say closestStop.
  // If closestStop is before or equal to target, we calculate segment from bus to closestStop,
  // then from closestStop to target.
  let closestStop = stops[0];
  let minDistance = Infinity;
  for (const stop of stops) {
    const d = getDistanceKm(busLat, busLng, stop.latitude, stop.longitude);
    if (d < minDistance) {
      minDistance = d;
      closestStop = stop;
    }
  }

  // If closest stop is the target, return direct distance ETA
  if (closestStop.stop_order === targetStopOrder) {
    const dist = getDistanceKm(busLat, busLng, closestStop.latitude, closestStop.longitude);
    return Math.max(1, Math.round((dist / avgSpeedKmh) * 60));
  }

  // Otherwise, sum segment from bus to the next stop after closestStop (or closestStop if it's ahead)
  // Let's calculate the path from closestStop to targetStop, and add the bus-to-closestStop segment.
  let pathDistance = 0;
  let prevLat = busLat;
  let prevLng = busLng;

  // Let's filter stops between closestStop and targetStop in chronological order
  const pathStops = stops
    .filter(
      (s) =>
        s.stop_order >= Math.min(closestStop.stop_order, targetStopOrder) &&
        s.stop_order <= Math.max(closestStop.stop_order, targetStopOrder)
    )
    .sort((a, b) => a.stop_order - b.stop_order);

  for (const stop of pathStops) {
    pathDistance += getDistanceKm(prevLat, prevLng, stop.latitude, stop.longitude);
    prevLat = stop.latitude;
    prevLng = stop.longitude;
  }

  // Convert distance to minutes
  const etaMinutes = Math.round((pathDistance / avgSpeedKmh) * 60);
  return Math.max(1, etaMinutes); // minimum 1 minute
}
