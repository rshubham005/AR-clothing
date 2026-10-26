// The clothing on offer: real garment models (public/garments, built by scripts/build-garment.mjs) and simple
// garments built in code (garment.ts).
import type { GarmentShape } from './garment'

export interface Swatch {
  name: string
  value: string
}

export interface CatalogItem {
  id: string
  name: string
  description: string
  /** A garment model (.glb following the rig in garment.ts)... */
  model?: string
  /** ...or a garment built in code. One of the two is set. */
  shape?: GarmentShape
  /** Model author to credit on the page, when the model's licence asks for it. */
  credit?: { author: string; url: string }
  colors: Swatch[]
}

const BASICS: Swatch[] = [
  { name: 'Navy', value: '#2f5d8a' },
  { name: 'Sand', value: '#c9b08a' },
  { name: 'Olive', value: '#5f6b3a' },
  { name: 'Brick', value: '#a8452f' },
  { name: 'White', value: '#f2efe8' },
  { name: 'Black', value: '#26241f' },
]

const SHORT_SLEEVE = { sleeves: 'short', neckDip: 0.16, sleeveLength: 0.5 } as const

export const CATALOG: CatalogItem[] = [
  {
    id: 'dress-shirt',
    name: 'Dress Shirt',
    description: 'Long sleeves, button-down',
    model: '/garments/dress-shirt.glb',
    colors: [
      { name: 'White', value: '#f4f2ec' },
      { name: 'Sky', value: '#a9c3dd' },
      { name: 'Blush', value: '#e3c1bd' },
      { name: 'Navy', value: '#2c3e5c' },
      { name: 'Black', value: '#26241f' },
    ],
  },
  {
    id: 'hoodie',
    name: 'Hoodie',
    description: 'Relaxed pullover, hood down',
    model: '/garments/hoodie.glb',
    // Link as given by CGTrader's "Give credit" box.
    credit: { author: 'andrewchristin', url: 'https://www.cgtrader.com/designers/andrewchristin?utm_source=credit&utm_source=credit_item_page' },
    colors: [
      { name: 'Mint', value: '#9fd8cf' },
      { name: 'Heather', value: '#b9b6b0' },
      { name: 'Charcoal', value: '#3b3a38' },
      { name: 'Cream', value: '#efe8d8' },
      { name: 'Burgundy', value: '#6e2a33' },
    ],
  },
  {
    id: 'classic-tee',
    name: 'Classic Tee',
    description: 'Regular fit, crew neck',
    shape: { ...SHORT_SLEEVE, length: 1.06, fit: 1 },
    colors: BASICS,
  },
  {
    id: 'oversized-tee',
    name: 'Oversized Tee',
    description: 'Relaxed fit, dropped shoulder',
    shape: { ...SHORT_SLEEVE, length: 1.16, fit: 1.14, sleeveLength: 0.62 },
    colors: [BASICS[5]!, BASICS[4]!, BASICS[1]!, { name: 'Sage', value: '#8fa38a' }],
  },
  {
    id: 'crop-tee',
    name: 'Crop Tee',
    description: 'Cropped above the waist',
    shape: { ...SHORT_SLEEVE, length: 0.68, fit: 1.02 },
    colors: [BASICS[4]!, { name: 'Blush', value: '#d9a5a0' }, { name: 'Lilac', value: '#a99ac4' }, BASICS[5]!],
  },
  {
    id: 'tank',
    name: 'Tank Top',
    description: 'Sleeveless, scoop neck',
    shape: { sleeves: 'none', length: 1.06, neckDip: 0.3, fit: 0.97, sleeveLength: 0 },
    colors: [BASICS[4]!, BASICS[5]!, BASICS[2]!, { name: 'Sky', value: '#7fa7c9' }],
  },
]
