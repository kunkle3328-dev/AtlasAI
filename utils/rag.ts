import { Source } from '../types';

export function retrieveContext(sources: Source[], query: string, limit: number = 3): string {
  if (sources.length === 0) return "";

  // 1. Simple Keyword Match Scoring (Simulation of Vector Search)
  const scored = sources.map(source => {
    const queryTerms = query.toLowerCase().split(' ');
    let score = 0;
    const contentLower = source.content.toLowerCase();
    
    queryTerms.forEach(term => {
      if (term.length > 3 && contentLower.includes(term)) {
        score += 1;
      }
    });

    // Boost recent items slightly
    return { source, score };
  });

  // 2. Sort by score
  scored.sort((a, b) => b.score - a.score);

  // 3. Take top K
  const topK = scored.slice(0, limit);

  // 4. Format for Prompt
  // STRICT LIMIT: Live API system instructions have a limit. 
  // We limit each chunk to 800 chars and total chunks to 3 to stay safe.
  const CHUNK_LIMIT = 800;
  
  return topK.map(item => {
    const safeContent = item.source.content.length > CHUNK_LIMIT 
        ? item.source.content.substring(0, CHUNK_LIMIT) + "..." 
        : item.source.content;
    return `[SOURCE_ID: ${item.source.id} | TITLE: ${item.source.title}]\n${safeContent}`;
  }).join('\n\n');
}

export async function processFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target?.result as string);
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
