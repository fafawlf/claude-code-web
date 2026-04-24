export type SkinId = 'warm' | 'cyberpunk' | 'wechat' | 'catgirl' | 'emochi';

export type SkinPreset = {
  id: SkinId;
  label: string;
  hint: string;
  swatches: [string, string, string];
};

export type SkinStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const SKINS: SkinPreset[] = [
  {
    id: 'warm',
    label: 'Warm dusk',
    hint: 'default focused workspace',
    swatches: ['#19161a', '#d97757', '#f0e8d9'],
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    hint: 'neon terminal deck',
    swatches: ['#080b10', '#f6ff00', '#00e7ff'],
  },
  {
    id: 'wechat',
    label: 'DevChat',
    hint: 'light chat bubbles',
    swatches: ['#f5f5f5', '#07c160', '#2e3238'],
  },
  {
    id: 'catgirl',
    label: 'Catgirl',
    hint: 'pastel cute desk',
    swatches: ['#fffafd', '#f0a8c8', '#a8d8c8'],
  },
  {
    id: 'emochi',
    label: 'Emochi',
    hint: 'bold mochi code buddy',
    swatches: ['#121212', '#FFEB00', '#ffffff'],
  },
];

export const DEFAULT_SKIN: SkinId = 'warm';
const SKIN_KEY = 'ccw_skin';
const SKIN_IDS = new Set<SkinId>(SKINS.map((s) => s.id));

export function isSkinId(value: string | null | undefined): value is SkinId {
  return !!value && SKIN_IDS.has(value as SkinId);
}

export function skinById(id: SkinId): SkinPreset {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0];
}

export function readSkin(storage: SkinStorageLike = window.localStorage): SkinId {
  const stored = storage.getItem(SKIN_KEY);
  return isSkinId(stored) ? stored : DEFAULT_SKIN;
}

export function writeSkin(id: SkinId, storage: SkinStorageLike = window.localStorage): SkinId {
  storage.setItem(SKIN_KEY, id);
  return id;
}
