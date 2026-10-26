// Sample furniture from Khronos glTF-Sample-Assets, served from /public/models.
// CC BY 4.0 requires naming the creator: see CREDITS below and the footer.
const KHRONOS_TREE = 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models'

export interface SampleModel {
  id: string
  name: string
  src: string
  poster: string
  placement: 'floor' | 'wall'
  creator: string
  license: string
  sourceUrl: string
}

const model = (id: string, name: string, folder: string, poster: string, creator: string, license: string, placement: 'floor' | 'wall' = 'floor'): SampleModel => ({
  id,
  name,
  src: `/models/${folder}.glb`,
  poster: `/images/models/${poster}.webp`,
  placement,
  creator,
  license,
  sourceUrl: `${KHRONOS_TREE}/${folder}`,
})

export const SAMPLE_MODELS: SampleModel[] = [
  model('velvet-sofa', 'Glam Velvet Sofa', 'GlamVelvetSofa', 'glam-velvet-sofa', 'Eric Chadwick, Wayfair, LLC', 'CC BY 4.0'),
  model('leather-sofa', 'Wood & Leather Sofa', 'SheenWoodLeatherSofa', 'sheen-wood-leather-sofa', 'Eric Chadwick, Darmstadt Graphics Group GmbH; original by Fran Calvente', 'CC BY 4.0 (improvements), CC0 (original)'),
  model('sheen-chair', 'Sheen Lounge Chair', 'SheenChair', 'sheen-chair', 'Eric Chadwick, Wayfair, LLC', 'CC0 1.0'),
  model('damask-chair', 'Damask Chair', 'ChairDamaskPurplegold', 'chair-damask', 'Eric Chadwick, Wayfair', 'CC BY 4.0'),
  model('barn-lamp', 'Barn Wall Lamp', 'AnisotropyBarnLamp', 'barn-lamp', 'Eric Chadwick, Wayfair, LLC', 'CC BY 4.0', 'wall'),
  model('punctual-lamp', 'Table Lamp', 'LightsPunctualLamp', 'punctual-lamp', 'DGG', 'CC BY 4.0'),
]
