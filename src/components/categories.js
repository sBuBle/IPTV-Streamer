// Categories shown as chips; each has a VectorCraft icon in public/brand/icons
export const CATEGORY_CHIPS = [
  ['news', 'News'], ['sports', 'Sports'], ['movies', 'Movies'], ['music', 'Music'],
  ['kids', 'Kids'], ['documentary', 'Documentary'], ['entertainment', 'Entertainment'],
  ['series', 'Series'], ['comedy', 'Comedy'], ['science', 'Science'], ['travel', 'Travel'],
  ['cooking', 'Cooking'], ['business', 'Business'], ['weather', 'Weather'],
  ['education', 'Education'], ['culture', 'Culture'],
].map(([id, name]) => ({ id, name, icon: `/brand/icons/cat-${id}.svg` }));
