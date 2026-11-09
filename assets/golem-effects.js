/*
 * « The golem's effects » — la section de golem.fm, RENDUE par golem.fm
 * (maestrium `frontend/scripts/export-effects.tsx`, importée par
 * tools/import_effects.py). Ici on ne fait que permuter ce qu'elle a rendu :
 * une section par système, une fiche par bloc. Aucune donnée de bloc n'est
 * lue ni calculée dans ce fichier.
 */

const DATA = new URL('effects/effects.json', import.meta.url)

export async function mountEffects(box) {
  const d = await fetch(DATA, { cache: 'no-cache' }).then((r) => r.json())
  let os = d.os[0]
  let picked = d.picked

  const render = () => {
    box.innerHTML = d.sections[os]
    const card = box.querySelector('.gb-card')
    if (card && d.cards[picked]) card.outerHTML = d.cards[picked]
    for (const t of box.querySelectorAll('.gb-tile[data-type]')) {
      const on = t.dataset.type === picked
      t.classList.toggle('is-sel', on)
      t.setAttribute('aria-pressed', String(on))
    }
  }

  box.addEventListener('click', (e) => {
    const sys = e.target.closest('.gb-os__btn')
    if (sys) {
      const i = [...box.querySelectorAll('.gb-os__btn')].indexOf(sys)
      if (d.os[i] && d.os[i] !== os) {
        os = d.os[i]
        render()
        box.querySelectorAll('.gb-os__btn')[i]?.focus()
      }
      return
    }
    const tile = e.target.closest('.gb-tile[data-type]')
    if (tile && tile.dataset.type !== picked && d.cards[tile.dataset.type]) {
      picked = tile.dataset.type
      render()
      box.querySelector(`.gb-tile[data-type="${CSS.escape(picked)}"]`)?.focus()
    }
  })
}
