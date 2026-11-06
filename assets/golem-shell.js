/*
 * L'interface EXACTE du golem, en lecture seule, sur un exemple d'instantané
 * d'usine — la même mécanique que golem.fm (maestrium lib/golemShell/
 * GolemScreen + DocScreen), sans React. La page dépose `window.__golemShell[id]`,
 * l'iframe ouvre `shell.html?shell=ro&gs=<id>`, et `golem-app/shell.js` répond
 * aux lectures `/api/…` avec ce dictionnaire ; les écritures ne partent nulle part.
 *
 * L'écran est dans son boîtier : la tablette du rack (golem.fm `TabletFrame`,
 * golem `app/device.html`) ou le téléphone (`PhoneFrame`), au gabarit natif
 * (1024 × 600, 390 × 844) mis à l'échelle — l'app du rack n'est pas faite pour
 * être reflowée.
 *
 * Deux usages :
 * - la DÉMO (`stage`) : on circule partout ; la mise en scène de
 *   `demo/stage.json` (tools/build_site.py) s'ajoute, et un rappel de preset
 *   rejoue l'état que le rack a relevé pour ce preset × cette scène ;
 * - la DOC (`lock`) : l'écran reste sur la route de son exemple — on regarde,
 *   on ouvre un tiroir, on ne part pas ailleurs.
 *
 * Toutes les adresses partent de ce fichier : le site marche à la racine d'un
 * domaine comme sous un sous-chemin.
 */

const SITE = new URL('../', import.meta.url)
const BASE = new URL('../golem-app/', import.meta.url)

//: `no-cache` = revalider à chaque fois (un 304 ne coûte rien) : une démo mise à
//: jour ne doit jamais tourner sur l'instantané d'hier resté dans le cache.
const json = (url) =>
  fetch(url, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`)
    return r.json()
  })

let buildP
const snaps = new Map()
const build = () => (buildP ??= json(new URL('build.json', BASE)))

/** Un instantané : ses lectures, et ses images (rangées sous `/golem-app/…`
 *  chez golem.fm) réécrites vers notre propre dossier. */
function snapshot(kind) {
  if (!snaps.has(kind)) {
    snaps.set(
      kind,
      json(new URL(`snapshots/${kind}/reads.json`, BASE)).then((s) => {
        const assets = {}
        for (const [k, v] of Object.entries(s.assets || {})) assets[k] = new URL(v.replace(/^\/golem-app\//, ''), BASE).href
        return { reads: s.reads, assets }
      }),
    )
  }
  return snaps.get(kind)
}

const APPS = {
  rack: { page: 'shell.html', w: 1024, h: 600 },
  phone: { page: 'shell-m.html', w: 390, h: 844 },
}

/** Ce que l'iframe ouvre pour la route d'un exemple (copie de `exampleScreen`). */
function screenOf(route) {
  const u = new URL(route, 'http://golem/app/')
  const app = u.pathname === '/app/' || u.pathname === '/app/index.html' ? 'rack' : u.pathname === '/app/m.html' ? 'phone' : null
  if (!app) return null
  return { app, query: u.search.replace(/^\?/, ''), route: u.hash.replace(/^#\/?/, '') }
}

/** Le halo : une feuille dans le document de l'iframe (même origine). */
function setHalo(doc, halo) {
  let style = doc.getElementById('gs-halo')
  if (!style) {
    style = doc.createElement('style')
    style.id = 'gs-halo'
    doc.head.appendChild(style)
  }
  const sel = (halo || '').split(/\s+/).filter(Boolean).map((a) => `[data-doc="${CSS.escape(a)}"]`).join(',')
  style.textContent = sel
    ? `${sel}{outline:3px solid #ffb020!important;outline-offset:3px;border-radius:6px;animation:gs-halo 1.6s ease-in-out infinite}` +
      `@keyframes gs-halo{50%{outline-color:rgba(255,176,32,.3)}}`
    : ''
}

/** Les gestes (`a > b`), chacun quand son ancre est rendue et que l'écran ne
 *  bouge plus depuis 300 ms — même règle que DocScreen `replay`. */
function replay(doc, click) {
  const steps = (click || '').split('>').map((x) => x.trim()).filter(Boolean)
  if (!steps.length) return
  let last = Date.now()
  const mo = new MutationObserver(() => { last = Date.now() })
  mo.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true })
  const next = (i, until) => {
    if (i >= steps.length) return mo.disconnect()
    const el = doc.querySelector(`[data-doc="${CSS.escape(steps[i])}"]`)
    if (el && Date.now() - last >= 300) {
      el.click()
      last = Date.now()
      next(i + 1, Date.now() + 6000)
    } else if (Date.now() < until) setTimeout(() => next(i, until), 100)
    else mo.disconnect()
  }
  next(0, Date.now() + 6000)
}

/** Le boîtier. Rend `{ root, content, screen }` : l'iframe va dans `content`,
 *  mis à l'échelle de `screen`. */
function device(app) {
  const el = (tag, cls, parent) => {
    const n = document.createElement(tag)
    n.className = cls
    if (parent) parent.appendChild(n)
    return n
  }
  if (app === 'phone') {
    const root = el('div', 'phone')
    const screen = el('div', 'phone__screen', root)
    const content = el('div', 'phone__content', screen)
    return { root, screen, content }
  }
  const root = el('div', 'tablet')
  el('span', 'tablet__cam', root)
  el('span', 'tablet__led', root)
  const screen = el('div', 'tablet__screen', root)
  const content = el('div', 'tablet__content', screen)
  el('span', 'tablet__glare', screen)
  const mark = el('span', 'tablet__mark', root)
  mark.innerHTML = '<s>/</s>golem'
  return { root, screen, content }
}

/** La démo montre TOUS les boutons (2026-11-01 : « il manque plein de boutons… et donc
 *  des fonctionnalités »). `?shell=ro` reste posé — la page de séparation garde sa coquille
 *  (`SHELL_RO`, services retirés de la v0.6) — mais les règles CSS qui masquent ou figent en
 *  lecture seule sont retirées de la feuille de l'app. Les écritures ne partent toujours nulle part. */
function unhide(doc) {
  for (const sheet of doc.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (let i = rules.length - 1; i >= 0; i--) {
      if (rules[i].selectorText?.includes('data-shell')) sheet.deleteRule(i)
    }
  }
}

let round = 0

/**
 * Monte un écran du golem dans `box` (vidé).
 * `opts` : `example`, `snapshot` (`factory`), `halo`, `click`, `fresh`, `controls` (tous les boutons),
 *          `stage` (la mise en scène de la démo), `lock` (rester sur la route),
 *          `onNotice(text)` (ce que la démo veut dire sous l'écran).
 * Rend `{ title, show(halo, click) }` — `show` rejoue sur l'écran déjà chargé.
 */
export async function mount(box, opts) {
  const { example, halo, click, stage, lock, onNotice, fresh } = opts
  box.dataset.state = 'loading'
  //: Sans variante demandée : l'instantané principal (`build.json` `main`, posé
  //: par import_shell.py) — `factory-keys` tant que le rack de référence a le
  //: MPK branché (2026-11-04), pas un `factory` qui n'existe pas.
  const kind = opts.snapshot ?? (await build()).main ?? 'factory'
  const [b, snap, ex] = await Promise.all([
    build(),
    snapshot(kind),
    json(new URL(`snapshots/${kind}/examples/${example}.json`, BASE)),
  ])
  const screen = screenOf(ex.route)
  if (!screen) throw new Error(`route ${ex.route}`)
  const id = `gs-${++round}`

  //: La mise en scène passe APRÈS l'exemple : elle est ce que la démo veut montrer.
  const dress = (st) => {
    if (!stage) return st
    const out = { ...st }
    if (stage.health) out.health = { ...stage.health, at: Date.now() / 1000 }
    if (stage.hotplug) out.hotplug = stage.hotplug
    if (stage.inputmap) out.inputmap = stage.inputmap
    if (stage.mounted && Array.isArray(st.rig_unmounted)) out.rig_unmounted = st.rig_unmounted.filter((u) => !stage.mounted.includes(u.id))
    return out
  }
  let state = dress(ex.state)
  const assets = { ...snap.assets }
  for (const [k, v] of Object.entries(stage?.assets || {})) assets[k] = new URL(v, SITE).href
  //: `fresh` : les lectures de la MACHINE que l'instantané ne relève jamais (des clés,
  //: le réseau), dans la forme qu'un golem jamais configuré rend (doc) — sinon
  //: l'écran attend une réponse qui ne viendra pas (« Loading… »).
  const reads = { ...(fresh || {}), ...snap.reads, ...ex.reads, ...(stage?.reads || {}), '/api/state': state }
  const now = Date.now() / 1000
  for (const k of stage?.now || []) if (reads[k]) reads[k] = { ...reads[k], at: now, ...('now' in reads[k] ? { now } : {}) }

  //: Le tampon du Designer (`/api/sandbox`) = le preset chargé, sur sa scène — ce que
  //: le rack y pose au rappel. Sans ça la démo ouvrait le Designer sur un « Sandbox »
  //: vide (2026-11-01). Un exemple qui fournit le sien le garde.
  const sandboxOf = (st) => {
    const doc = reads[`/api/preset/${st.preset_id}`]
    return doc ? { preset: doc, scene: st.scene_id ?? null, edit_rev: 0 } : reads['/api/sandbox']
  }
  if (stage && !ex.reads?.['/api/sandbox']) reads['/api/sandbox'] = sandboxOf(state)

  let active = stage?.active
  let tunerTimer = 0
  let frame = null
  //: Pas de `sandbox_rev` ici : le rack ne l'avance que pour un patch ARRIVÉ de golem.fm
  //: (page-designer.js le dit à l'écran) — l'avancer sur un rappel l'aurait fait mentir.
  //: Un patch joué (`patch:<id>`) n'est pas au catalogue : sa fiche passe par `/api/live/trial`.
  //: Hors patch, le rack répond 404 → l'app lit `null` (jamais une fiche vide).
  const trialOf = (st) => (String(st.preset_id || '').startsWith('patch:') && stage?.trials?.[st.preset_id]) || null
  if (stage) reads['/api/live/trial'] = trialOf(state)
  const push = (st) => {
    state = st
    reads['/api/state'] = st
    if (stage) reads['/api/live/trial'] = trialOf(st)
    if (stage) reads['/api/sandbox'] = sandboxOf(st)
    if (!frame?.contentWindow) opts.onDebug?.('  → no frame to push to')
    frame?.contentWindow?.postMessage({ type: 'golem-shell:state', id, state: st }, location.origin)
  }
  //: Une écriture de l'app. La démo n'en rejoue que deux, et sans rien calculer :
  //: le rappel d'un preset × scène reprend l'état RELEVÉ par le rack ; un stomp
  //: inverse son interrupteur (golem-ed, 2026-11-01 : suffisant pour l'œil).
  const onWrite = stage
    ? (method, path, body) => {
        opts.onDebug?.(`${method} ${path} ${body || ''}`)
        let p = {}
        try { p = JSON.parse(body || '{}') } catch { /* corps illisible : rien à rejouer */ }
        if (path === '/api/recall') {
          //: `{slot}` = une ligne de la liste au pied ; `{preset, scene}` ; `{scene}` seule = ce preset-ci.
          const preset = p.slot != null ? stage.lists?.[active]?.presets?.[p.slot] : p.preset || state.preset_id
          const scene = p.scene || stage.first?.[preset]
          const diff = stage.live?.[`${preset}|${scene}`]
          const hit = diff && { ...stage.live_base, ...diff }
          opts.onDebug?.(`  → ${preset}|${scene} ${hit ? 'played' : 'NOT FOUND'}`)
          if (hit) push(dress(hit))
          else onNotice?.('This preset and scene are not in the demo snapshot yet.')
        } else if (path === '/api/stomp' && p.switch != null) {
          const sw = String(p.switch)
          push({ ...state, stomps: { ...state.stomps, [sw]: !state.stomps?.[sw] } })
        } else if (/^\/api\/setlists\/[^/]+\/activate$/.test(path)) {
          //: Le sélecteur de /live : la setlist ou la bank passe AU PIED (sa liste, telle que
          //: le rack la rend) ; l'app rappelle ensuite elle-même sa première ligne.
          const sid = decodeURIComponent(path.split('/')[3])
          if (stage.lists?.[sid]) {
            active = sid
            reads['/api/foot-list'] = stage.lists[sid]
            const sl = reads['/api/setlists']
            if (sl?.setlists) reads['/api/setlists'] = { ...sl, active: sid, setlists: sl.setlists.map((x) => ({ ...x, active: x.id === sid })) }
          }
        } else if (path === '/api/metronome') {
          push({ ...state, click: { ...state.click, on: !!p.on } })
        } else if (path === '/api/live-lock') {
          push({ ...state, live_lock: !!p.on })
        } else if (path === '/api/kit/audition' && p.file) {
          //: Le tap d'un pad : le rack le joue dans ses enceintes, la démo dans le navigateur
          //: (le même fichier que la page Samples, `stage_samples`).
          const a = assets[`/api/sample?file=${encodeURIComponent(p.file)}`]
          if (a) new Audio(a).play().catch(() => {})
        } else if (path === '/api/tuner') {
          //: Mis en scène : une corde de Mi grave qu'on accorde. L'écran confirme une note sur trois
          //: lectures (`t.seq`, live-tuner.js) : on lui en envoie une toutes les 120 ms, qui se
          //: rapproche du juste, comme une vraie corde.
          clearInterval(tunerTimer)
          if (p.on) {
            let seq = 0
            tunerTimer = setInterval(() => {
              seq += 1
              const cents = seq < 20 ? -18 + seq : (Math.random() - 0.5) * 3
              push({ ...state, tuner: { ...state.tuner, on: true, active: true, note: 'E', octave: 2, midi: 40,
                cents, freq: 82.41 * 2 ** (cents / 1200), conf: 1, seq } })
            }, 120)
          } else push({ ...state, tuner: { ...state.tuner, on: false, active: false } })
        } else if (path === '/api/perf/start' || path === '/api/perf/stop') {
          const on = path.endsWith('start')
          reads['/api/perf'] = { ...(reads['/api/perf'] || {}), recording: on, file: on ? 'demo-take.wav' : '',
            started_at: on ? new Date().toISOString() : '', error: '' }
          push({ ...state, perf: reads['/api/perf'] })
        }
      }
    : undefined

  //: L'état des blocs selon le preset que le Designer envoie : ce qu'un golem en
  //: service a relevé (`tools/read_rack.py`). Un preset inconnu → la réponse de
  //: l'instantané, comme avant.
  const onRead = stage?.blocks_status
    ? (method, path, body) => {
        if (path !== '/api/blocks/status') return undefined
        let p = null
        try { p = JSON.parse(body || '{}').preset } catch { return undefined }
        const pid = p && (p.id || '')
        return stage.blocks_status[pid] || stage.blocks_status[String(pid).replace(/^patch:/, '')] ||
          stage.blocks_status[`patch:${pid}`] || undefined
      }
    : undefined

  ;(window.__golemShell ??= {})[id] = {
    reads,
    state,
    assets,
    postReads: b.post_reads,
    build: b.commit,
    onWrite,
    onRead,
  }

  const { page, w, h } = APPS[screen.app]
  frame = document.createElement('iframe')
  frame.title = `golem — ${ex.title}`
  frame.width = w
  frame.height = h
  const home = screen.route ? `#/${screen.route}` : ''
  const search = `${screen.query ? `${screen.query}&` : ''}shell=ro&gs=${encodeURIComponent(id)}&v=${b.shell_v || ''}`
  frame.src = new URL(`${b.dir}/${page}?${search}${home}`, BASE).href

  let doc = null
  let guard = 0
  frame.addEventListener('load', () => {
    box.dataset.state = 'ready'
    doc = frame.contentDocument
    if (!doc) return
    setHalo(doc, halo)
    replay(doc, click ?? ex.click)
    if (opts.controls) unhide(doc)
    if (lock) {
      //: La doc reste cadrée sur son exemple : une autre route (un onglet de la
      //: barre, un lien) ramène à celle de l'exemple ; un onglet du Companion
      //: (`?tab=`, posé sans changer le hash) recharge l'exemple.
      //: La route de référence est celle où l'app s'est POSÉE (elle complète
      //: parfois la sienne : `system/connect` → `system/connect/wifi`), pas
      //: celle qu'on lui a donnée — sinon on se battrait avec elle.
      const win = frame.contentWindow
      const tab0 = new URLSearchParams(win.location.search).get('tab')
      let settled = null
      setTimeout(() => { settled = frame.contentWindow?.location.hash ?? home }, 1500)
      clearInterval(guard)
      guard = setInterval(() => {
        if (!frame.isConnected) return clearInterval(guard)
        const loc = frame.contentWindow.location
        if (screen.app === 'rack' && settled != null && loc.hash !== settled) loc.hash = settled
        else if (screen.app === 'phone' && new URLSearchParams(loc.search).get('tab') !== tab0) {
          clearInterval(guard)
          mount(box, opts)
        }
      }, 250)
    }
  })

  //: Un remontage remplace le précédent : son iframe et sa configuration partent.
  for (const old of box.querySelectorAll('iframe')) delete window.__golemShell[old.dataset.gs]
  box.replaceChildren()
  frame.dataset.gs = id
  const dev = device(screen.app)
  dev.content.appendChild(frame)
  box.appendChild(dev.root)
  box.dataset.app = screen.app

  new ResizeObserver(([e]) => {
    const k = e.contentRect.width / w
    if (k > 0) dev.content.style.transform = `scale(${k})`
  }).observe(dev.screen)

  return {
    title: ex.title,
    show(h2, c2) {
      if (!doc) return
      setHalo(doc, h2)
      replay(doc, c2)
    },
  }
}
