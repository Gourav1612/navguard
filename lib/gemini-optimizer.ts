import { getDistanceMeters } from './utils';

/**
 * Optimizes route stops sequence using Gemini AI if GEMINI_API_KEY is configured.
 * Falls back to local Nearest-Neighbor TSP optimization if key is missing or API call fails.
 */
export async function optimizeRouteWithGemini(stops: { latitude: number; longitude: number; [key: string]: any }[]) {
  if (stops.length <= 2) return stops;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Automatic local fallback
    return localOptimize(stops);
  }

  try {
    const startStop = stops[0];
    const stopsListString = stops
      .map((s, idx) => `Index ${idx}: Lat ${s.latitude}, Lng ${s.longitude}, Name: ${s.name || ''}`)
      .join('\n');

    const prompt = `You are a route optimization AI. 
Calculate the shortest path visiting all stops starting from the school (index 0) (Travelling Salesperson Problem).
Starting point (School, index 0): Lat ${startStop.latitude}, Lng ${startStop.longitude}

Stops to visit:
${stopsListString}

Return the results in JSON format as an array of numbers representing the optimized order of indices.
Example output format: [0, 3, 1, 2]`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const indices: number[] = JSON.parse(text);
        // Verify indices are valid and match stops count
        if (
          Array.isArray(indices) && 
          indices.length === stops.length && 
          indices[0] === 0 && 
          indices.every(idx => idx >= 0 && idx < stops.length)
        ) {
          return indices.map((originalIdx, newIdx) => ({
            ...stops[originalIdx],
            stop_order: newIdx,
          }));
        }
      }
    }
  } catch (err) {
    console.error('Gemini optimization failed, using local Nearest Neighbor fallback:', err);
  }

  return localOptimize(stops);
}

function localOptimize(stops: any[]) {
  const optimized = [stops[0]];
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

  return optimized.map((stop, idx) => ({
    ...stop,
    stop_order: idx,
  }));
}
