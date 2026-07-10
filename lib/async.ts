// Concurrency limiter helper to run promises with a limit
export async function runWithConcurrencyLimit<T, R>(
  limit: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const p = fn(items[i], i).then(res => {
      results[i] = res;
    });
    executing.push(p);
    
    if (limit <= items.length) {
      const clean = p.then(() => {
        const index = executing.indexOf(p);
        if (index > -1) {
          executing.splice(index, 1);
        }
      });
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  await Promise.all(executing);
  return results;
}
