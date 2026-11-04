// Picture tokens of the 12 elements (4 colours x 3 sizes), drawn as in the world but with no level names.
// Shared by the report (fill-in-the-blank rules) and the generalisation tasks (palette to drop things into the world).

/** An element, as the analysis sees it: level (tier) and colour (type). */
export interface Token {
  tier: number;
  type: number;
}

// TUNE: the words participants see in tooltips (never level names)
export const TOKEN_WORDS = {
  size: ['small', 'medium', 'large'],
  colour: ['light blue', 'purple', 'red', 'green'],
};

export function tokenName(t: Token): string {
  return `${TOKEN_WORDS.size[t.tier]} ${TOKEN_WORDS.colour[t.type]}`;
}

export const tokenKey = (t: Token) => `${t.tier}:${t.type}`;
export const parseKey = (k: string): Token | null => {
  const m = /^(\d):(\d)$/.exec(k);
  return m ? { tier: Number(m[1]), type: Number(m[2]) } : null;
};

export interface TokenLook {
  /** css colours per tier [cells, organisms, herds], indexed by type */
  colours: string[][];
  /** shape drawn inside each cell type */
  shapes: string[];
}

export const SIZE_PX = [20, 28, 38];

/** Small inline SVG of an element: a cell with its shape, a plain blob, or a pale disc. */
export function tokenSvg(t: Token, look: TokenLook): string {
  const c = look.colours[t.tier][t.type];
  const px = SIZE_PX[t.tier];
  let body: string;
  if (t.tier === 0) {
    const shape = look.shapes[t.type];
    const inner =
      shape === 'triangle'
        ? `<polygon points="10,4.5 15,13.5 5,13.5" fill="${c}"/>`
        : shape === 'square'
          ? `<rect x="6" y="6" width="8" height="8" fill="${c}"/>`
          : shape === 'star'
            ? `<polygon points="10,3.8 11.6,8.3 16.3,8.3 12.5,11.2 13.9,15.8 10,13 6.1,15.8 7.5,11.2 3.7,8.3 8.4,8.3" fill="${c}"/>`
            : `<circle cx="10" cy="10" r="3.6" fill="${c}"/>`;
    body = `<circle cx="10" cy="10" r="8.3" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="1.6"/>${inner}`;
  } else if (t.tier === 1) {
    body = `<path d="M10 1.8 C14.8 1.6 18.4 5 18.1 10.2 C17.8 15.2 14.4 18.3 9.6 18.2 C4.9 18 1.7 14.6 1.9 9.8 C2.1 5 5.4 2 10 1.8 Z" fill="${c}" stroke="${c}" stroke-width="1"/>`;
  } else {
    body = `<circle cx="10" cy="10" r="9" fill="${c}" fill-opacity="0.55" stroke="${c}" stroke-width="0.8"/>`;
  }
  return `<svg width="${px}" height="${px}" viewBox="0 0 20 20" aria-hidden="true">${body}</svg>`;
}
