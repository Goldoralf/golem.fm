/*
 * /fx — the gallery of the golem's pedals. Everything is DRAWN by the golem-fx scripts
 * (assets/fx/vendor/: GolemPedals, GolemStage, GOLEM_VISUALS), loaded before this module.
 * This file only wires the page: the lane demo (pedals on the floor and block tiles,
 * switched together) and the cards a click turns on or off.
 *
 * No brand anywhere: an amp carries its family (Clean, Crunch, High gain, Bass), a captured
 * pedal its own, a cab its size.
 */

const G = window.GolemPedals
const STAGE = window.GolemStage
const V = window.GOLEM_VISUALS

const FAM = { clean: 'Clean', crunch: 'Crunch', 'high-gain': 'High gain', bass: 'Bass' }

/** The demo lanes: the plates carry the family, never a brand. */
function lanes() {
  const amp = (type, family, extra) => ({ type, family, title: FAM[family], ...extra })
  const ped = (family, title) => ({ type: 'pedal-nam', archetype: { family }, title })
  const cab = (size, family) => ({ type: 'cab', title: size, size, family })
  return {
    Guitar: [
      { type: 'gate' },
      ped('overdrive', 'Drive'),
      { type: 'guitar-drive' },
      { type: 'wah' },
      { type: 'chorus' },
      amp('amp-nam', 'crunch'),
      cab('4x12', 'crunch'),
      { type: 'delay' },
      { type: 'reverb' },
    ],
    Clean: [
      { type: 'comp' },
      { type: 'tremolo' },
      { type: 'vibrato' },
      amp('amp', 'clean', { form: 'combo' }),
      { type: 'delay-tape' },
      { type: 'reverb-plate' },
    ],
    Bass: [{ type: 'comp' }, { type: 'octaver' }, ped('bass', 'Bass'), amp('amp', 'bass', { size: '8x10' })],
    Voice: [
      { type: 'deesser' },
      { type: 'comp' },
      { type: 'eq' },
      { type: 'golem-double' },
      { type: 'delay' },
      { type: 'reverb-shimmer' },
    ],
    Keys: [{ type: 'rotary' }, { type: 'chorus-js' }, { type: 'eq-graphic' }, { type: 'reverb-room' }],
    'High gain': [
      { type: 'met' },
      { type: 'emet' },
      { type: 'shem' },
      amp('amp-nam', 'high-gain'),
      cab('4x12', 'high-gain'),
      { type: 'delay' },
      { type: 'reverb-plate' },
    ],
    Metal: STAGE.fromGolem(
      {
        pre: [
          { id: 'gate', type: 'gate' },
          { id: 'eq', type: 'eq' },
        ],
        split: {
          mode: 'merge',
          gain: -3,
          branches: [
            {
              id: 'lane-a',
              blocks: [
                { id: 'a', type: 'amp-nam', label: FAM['high-gain'] },
                { id: 'ca', type: 'cab', label: '4x12' },
              ],
            },
            {
              id: 'lane-b',
              blocks: [
                { id: 'b', type: 'amp-nam', label: FAM.crunch },
                { id: 'cb', type: 'cab', label: '4x12' },
              ],
            },
          ],
        },
        post: [
          { id: 'boost', type: 'clean-boost' },
          { id: 'kill', type: 'killswitch' },
          { id: 'dly', type: 'delay' },
          { id: 'verb', type: 'reverb-plate' },
        ],
      },
      { blocks: { boost: false, kill: false, dly: false }, branches: { 'lane-b': { mute: true } } },
    ),
  }
}

/** The block at a path of the chain: `3`, or `3.1.0` inside a branch. */
function at(chain, path) {
  const [i, b, j] = path.split('.').map(Number)
  if (b === undefined || Number.isNaN(b)) return { list: chain, i }
  const br = chain[i]?.split?.branches[b]
  return br ? { list: br.items, i: j } : null
}

function mountDemo(root) {
  const scene = root.querySelector('.fx-scene')
  const tilesBox = root.querySelector('.fx-tiles')
  const laneBtns = [...root.querySelectorAll('[data-lane]')]
  const floorBtns = [...root.querySelectorAll('[data-floor]')]
  const base = lanes()
  const chains = {}
  let lane = 'Guitar'
  let floor = 'stage'
  const chain = () => chains[lane] ?? base[lane]

  const tile = (it, path) => {
    const g = V.gfx[Object.keys(V.gfx).find((k) => V.gfx[k].blocks.includes(it.type)) ?? '']
    const b = G.blockByType(it.type) ??
      (g ? { type: it.type, glyph: g.glyph, name: g.name, short: g.name, color: g.color, category: g.category } : null) ?? {
        type: it.type,
        name: it.type,
      }
    return G.blockTile({ ...b, ...(it.title ? { short: it.title } : {}) }, { on: it.on !== false }).replace(
      'class="gp-tile',
      `data-idx="${path}" tabindex="0" role="button" class="gp-tile`,
    )
  }
  const arrow = '<span class="fx-tiles__arrow" aria-hidden="true">›</span>'

  const render = () => {
    const c = chain()
    scene.innerHTML = STAGE.render(c, { floor })
    tilesBox.innerHTML = c
      .map(
        (it, i) =>
          (i ? arrow : '') +
          (it.split
            ? `<span class="fx-tiles__split">${it.split.branches
                .map(
                  (br, b) =>
                    `<span class="fx-tiles__branch${br.mute ? ' is-muted' : ''}"><button type="button" class="fx-tiles__tag" data-split="${i}" data-b="${b}" aria-pressed="${!br.mute}">${String.fromCharCode(65 + b)}</button>${br.items
                      .map((x, j) => (j ? arrow : '') + tile(x, `${i}.${b}.${j}`))
                      .join('')}</span>`,
                )
                .join('')}</span>`
            : tile(it, String(i))),
      )
      .join('')
    for (const b of laneBtns) b.setAttribute('aria-pressed', String(b.dataset.lane === lane))
    for (const b of floorBtns) b.setAttribute('aria-pressed', String(b.dataset.floor === floor))
  }

  const update = (fn) => {
    const next = JSON.parse(JSON.stringify(chain()))
    fn(next)
    chains[lane] = next
    render()
  }
  const toggle = (path) =>
    update((c) => {
      const hit = at(c, path)
      const it = hit?.list[hit.i]
      if (!hit || !it) return
      it.on = it.on === false
      //: A head and its cab switch together.
      const next = hit.list[hit.i + 1]
      if (next && G.blockByType(it.type)?.family === 'nam-head' && G.blockByType(next.type)?.family === 'nam-cab')
        next.on = it.on
    })
  const mute = (i, b) =>
    update((c) => {
      const br = c[i]?.split?.branches[b]
      if (br) br.mute = !br.mute
    })
  const onPick = (e) => {
    const tag = e.target.closest('[data-b]')
    if (tag) return mute(Number(tag.dataset.split), Number(tag.dataset.b))
    const blk = e.target.closest('[data-idx]')
    if (!blk?.dataset.idx) return
    const path = blk.dataset.idx
    toggle(path)
    //: The tiles were redrawn: keep the keyboard where it was.
    if (blk.closest('.fx-tiles')) tilesBox.querySelector(`[data-idx="${path}"]`)?.focus()
  }

  scene.addEventListener('click', onPick)
  tilesBox.addEventListener('click', onPick)
  tilesBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPick(e)
    }
  })
  for (const b of laneBtns)
    b.addEventListener('click', () => {
      lane = b.dataset.lane
      render()
    })
  for (const b of floorBtns)
    b.addEventListener('click', () => {
      floor = b.dataset.floor
      render()
    })
  render()
}

/** A card's drawing, from its `data-draw` (written by the site builder). */
function draw(d, on) {
  if (d.fn === 'pedalFor') return G.pedalFor({ type: d.a, on })
  if (d.fn === 'namCab') return G.namCab(d.opts)
  return d.a !== undefined ? G[d.fn](d.a, { ...d.opts, on }) : G[d.fn]({ ...d.opts, on })
}

export function mountFx(page) {
  page.querySelector('.fx-defs').innerHTML = G.defs()
  mountDemo(page.querySelector('#demo'))
  for (const slot of page.querySelectorAll('.fx-card__slot[data-draw]')) {
    const d = JSON.parse(slot.dataset.draw)
    let on = true
    slot.innerHTML = draw(d, on)
    slot.addEventListener('click', () => {
      on = !on
      slot.setAttribute('aria-pressed', String(on))
      slot.innerHTML = draw(d, on)
    })
  }
}
