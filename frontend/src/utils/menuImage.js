const normalizeText = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const IMAGE_QUERY_RULES = [
  { keywords: ['mi sao', 'misao', 'nouille', 'noodle', 'chow mein'], query: 'chow mein stir fry noodles' },
  { keywords: ['riz cantonnais', 'fried rice', 'riz'], query: 'fried rice asian dish' },
  { keywords: ['soupe', 'ramen', 'pho'], query: 'asian noodle soup bowl' },
  { keywords: ['brochette', 'grillade', 'grille', 'grillé', 'grill'], query: 'grilled skewers' },
  { keywords: ['burger'], query: 'gourmet beef burger' },
  { keywords: ['pizza'], query: 'wood fired pizza' },
  { keywords: ['poulet'], query: 'roast chicken plate' },
  { keywords: ['poisson', 'saumon'], query: 'grilled fish fillet plate' },
  { keywords: ['crevette', 'gambas'], query: 'shrimp dish plate' },
  { keywords: ['salade', 'entree', 'entrée', 'starter', 'appetizer'], query: 'fresh appetizer salad' },
  { keywords: ['dessert', 'gateau', 'gâteau', 'mousse', 'tarte'], query: 'restaurant dessert plating' },
  { keywords: ['boisson', 'jus', 'cocktail', 'drink', 'soda'], query: 'refreshing drink glass' },
  { keywords: ['snack', 'sandwich', 'panini', 'tacos', 'frites'], query: 'street food snack platter' },
];

const CATEGORY_QUERY_MAP = {
  entree: 'restaurant appetizer plate',
  starter: 'restaurant appetizer plate',
  main: 'restaurant main course',
  snack: 'street food snack plate',
  dessert: 'restaurant dessert plating',
  drink: 'refreshing drink glass',
  side: 'restaurant side dish',
};

export const getSuggestedImageQuery = ({ name = '', category = '' } = {}) => {
  const source = `${normalizeText(name)} ${normalizeText(category)}`.trim();

  for (const rule of IMAGE_QUERY_RULES) {
    if (rule.keywords.some((keyword) => source.includes(normalizeText(keyword)))) {
      return rule.query;
    }
  }

  const normalizedCategory = normalizeText(category);
  if (normalizedCategory && CATEGORY_QUERY_MAP[normalizedCategory]) {
    return CATEGORY_QUERY_MAP[normalizedCategory];
  }

  if (normalizeText(name)) {
    return `${name} dish`;
  }

  return 'restaurant food plate';
};

const PLACEHOLDER_THEME_BY_CATEGORY = {
  entree: { from: '#0f766e', to: '#115e59' },
  starter: { from: '#0f766e', to: '#115e59' },
  main: { from: '#b45309', to: '#92400e' },
  snack: { from: '#b91c1c', to: '#7f1d1d' },
  dessert: { from: '#be185d', to: '#9d174d' },
  drink: { from: '#1d4ed8', to: '#1e3a8a' },
  side: { from: '#4d7c0f', to: '#3f6212' },
};

const escapeXml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const buildLocalMenuPlaceholder = ({ name = '', category = '' } = {}, size = '1200x900') => {
  const safeName = String(name || 'Menu').trim() || 'Menu';
  const safeCategory = normalizeText(category);
  const theme = PLACEHOLDER_THEME_BY_CATEGORY[safeCategory] || { from: '#334155', to: '#0f172a' };
  const initials = safeName
    .split(/\s+/)
    .map((chunk) => chunk[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'M';

  const [widthRaw, heightRaw] = String(size || '1200x900').split('x');
  const width = Number(widthRaw) || 1200;
  const height = Number(heightRaw) || 900;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${theme.from}"/>
          <stop offset="100%" stop-color="${theme.to}"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.14)}" fill="rgba(255,255,255,0.14)"/>
      <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.85)}" r="${Math.round(width * 0.16)}" fill="rgba(255,255,255,0.1)"/>
      <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(width * 0.18)}" fill="#ffffff" font-weight="700">${escapeXml(initials)}</text>
      <text x="50%" y="78%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(width * 0.045)}" fill="#e2e8f0">${escapeXml(safeName)}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

export const getSuggestedMenuImageUrl = (menuLike = {}, size = '1200x900') => {
  return buildLocalMenuPlaceholder(menuLike, size);
};
