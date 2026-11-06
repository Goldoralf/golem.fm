/*
 * LA COQUILLE — conception/plan-golem-shell.md §2. Chargé AVANT main.js par le
 * `shell.html` que tools/sync_golem_app.py dérive de l'index.html du rack.
 *
 * L'app du golem, telle quelle, s'affiche dans une iframe de golem.fm. Elle
 * croit parler à son bridge ; elle parle à ce script :
 *
 * - une lecture `/api/…` reçoit le JSON que la page hôte a déposé dans
 *   `window.__golemShell[<id>]` (`?gs=<id>`). Une lecture non couverte reçoit
 *   `{}` ET est signalée à l'hôte (`golem-shell:miss`) — jamais quatre secondes
 *   de réessais silencieux ;
 * - une ÉCRITURE ne part nulle part : `{ok: true}` (sauf un POST qui est une
 *   LECTURE, `cfg.postReads` : traité comme une lecture non couverte). Rien ne s'édite depuis
 *   golem.fm (2026-10-09 : « on ne fait qu'afficher ») ; `?shell=ro`
 *   cache déjà les contrôles d'édition côté rack (docs/shell.md) ;
 * - le WebSocket d'état est un objet qui pousse l'état fourni, puis se tait
 *   (l'hôte peut en pousser un autre : `golem-shell:state`) ;
 * - `localStorage` / `sessionStorage` sont une mémoire : l'app du rack y range
 *   son jeton et ses préférences, pas dans le stockage de golem.fm.
 *
 * Pas de faux bridge : ni logique, ni état simulé.
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = params.get('gs') || '';
  var cfg = {};
  try { cfg = (parent.__golemShell && parent.__golemShell[id]) || {}; } catch (e) { cfg = {}; }
  var reads = cfg.reads || {};
  var state = cfg.state || {};

  function tell(msg) {
    msg.id = id;
    try { parent.postMessage(msg, location.origin); } catch (e) { /* hôte parti */ }
  }

  // — les lectures —
  //: Ce que l'app lit au démarrage et qui ne dépend d'aucune donnée : servi ici
  //: pour que l'hôte n'ait pas à le savoir.
  var BUILTIN = {
    '/api/auth/whoami': { local: true, token: 'local' },
    '/api/app-build': { build: cfg.build || 'shell' },
    '/api/ui/geometry': {},
  };

  function pathOf(input) {
    var u = typeof input === 'string' ? input : (input && input.url) || String(input);
    try { return new URL(u, location.href); } catch (e) { return null; }
  }

  //: Une adresse, sous une seule écriture : chaque segment décodé puis
  //: réencodé. L'app demande `/api/song/rs%3Aabc`, une autre page `rs:abc` ;
  //: l'instantané du rack (docs/shell.md §3) range les deux sous le même nom.
  function canon(path) {
    return path.split('/').map(function (s) {
      try { return encodeURIComponent(decodeURIComponent(s)); } catch (e) { return s; }
    }).join('/');
  }
  Object.keys(reads).forEach(function (key) {
    var sp = key.indexOf(' ') > 0 ? key.indexOf(' ') + 1 : 0;
    var q = key.indexOf('?');
    var p = q < 0 ? key.slice(sp) : key.slice(sp, q);
    var c = key.slice(0, sp) + canon(p) + (q < 0 ? '' : key.slice(q));
    if (!(c in reads)) reads[c] = reads[key];
  });
  //: Une adresse d'asset peut porter sa requête (`/api/sample?file=…` : un
  //: fichier par requête) : seul le chemin passe par canon.
  //: La requête aussi passe sous une seule écriture : chaque paramètre décodé
  //: puis réencodé, dans l'ordre. `?file=assets%2Fsamples%2F…` et
  //: `?file=assets/samples/…` désignent le même son de kit.
  function canonQuery(search) {
    if (!search || search === '?') return '';
    try {
      var out = [];
      new URLSearchParams(search).forEach(function (v, k) {
        out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      return '?' + out.join('&');
    } catch (e) { return search; }
  }
  var assets = {};
  Object.keys(cfg.assets || {}).forEach(function (k) {
    var q = k.indexOf('?');
    assets[q < 0 ? canon(k) : canon(k.slice(0, q)) + canonQuery(k.slice(q))] = cfg.assets[k];
  });
  //: Les adresses de l'app que la table peut servir hors fetch : le bridge, et
  //: les démos de patchs et presets que le rack sert hors `/api/`.
  var MEDIA_PREFIX = ['/api/', '/library/previews/'];

  //: `GET /api/x?q` puis `/api/x?q`, sans la requête ensuite (une lecture
  //: avec requête de l'instantané : `/api/groove-notes?file=…`), puis le plus
  //: long préfixe déclaré `…/*`.
  function lookup(method, path, search) {
    path = canon(path);
    if (search) {
      var r = lookup1(method, path + search);
      if (r.hit) return r;
    }
    return lookup1(method, path);
  }
  function lookup1(method, path) {
    var k = method + ' ' + path;
    if (k in reads) return { hit: true, body: reads[k] };
    if (method === 'GET') {
      if (path in reads) return { hit: true, body: reads[path] };
      if (path in BUILTIN) return { hit: true, body: BUILTIN[path] };
    }
    var best = null;
    Object.keys(reads).forEach(function (key) {
      var m = key.indexOf(' ') > 0 ? key.slice(0, key.indexOf(' ')) : 'GET';
      var p = key.indexOf(' ') > 0 ? key.slice(key.indexOf(' ') + 1) : key;
      if (m !== method || p.slice(-2) !== '/*') return;
      var pre = p.slice(0, -1);
      if (path.indexOf(pre) === 0 && (!best || pre.length > best.length)) best = { length: pre.length, key: key };
    });
    if (best) return { hit: true, body: reads[best.key] };
    return { hit: false };
  }

  function json(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var u = pathOf(input);
    if (!u || u.origin !== location.origin || u.pathname.indexOf('/api/') !== 0) return realFetch(input, init);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var r = lookup(method, u.pathname, u.search);
    if (r.hit) return Promise.resolve(json(r.body));
    //: Un POST qui est une LECTURE (le preset du Designer en corps :
    //: `/api/blocks/status`, `/api/backing/drawer`) : non couvert, il est
    //: signalé comme une lecture — jamais un {ok: true} muet.
    var postRead = method === 'POST' && (cfg.postReads || []).indexOf(canon(u.pathname)) >= 0;
    //: Une POST-lecture dont la réponse dépend du CORPS (l'état des blocs de CE
    //: preset) : l'hôte PEUT y répondre (`cfg.onRead`, absent sur golem.fm) — la
    //: démo publique sert ce qu'un golem en service a relevé pour chaque preset.
    if (postRead && typeof cfg.onRead === 'function') {
      var rbody = init && typeof init.body === 'string' ? init.body : null;
      var hit = undefined;
      try { hit = cfg.onRead(method, canon(u.pathname), rbody); } catch (e) { hit = undefined; }
      if (hit !== undefined) return Promise.resolve(json(hit));
    }
    if (method !== 'GET' && !postRead) {
      //: L'hôte PEUT voir l'écriture (`cfg.onWrite`, absent sur golem.fm) : la
      //: démo publique du golem rejoue un rappel de preset avec un état relevé
      //: par le rack. Rien ne part, la réponse reste `{ok: true}`.
      if (typeof cfg.onWrite === 'function') {
        var body = init && typeof init.body === 'string' ? init.body : null;
        try { cfg.onWrite(method, canon(u.pathname), body); } catch (e) { /* hôte fautif : l'app n'en saura rien */ }
      }
      return Promise.resolve(json({ ok: true }));
    }
    tell({ type: 'golem-shell:miss', method: method, path: u.pathname });
    return Promise.resolve(json({}));
  };
  if (navigator.sendBeacon) navigator.sendBeacon = function () { return true; };

  // — l'état du rig —
  var sockets = [];
  function FakeSocket(url) {
    var ws = this;
    ws.url = url; ws.readyState = 0;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    sockets.push(ws);
    setTimeout(function () {
      if (ws.readyState !== 0) return;
      ws.readyState = 1;
      if (ws.onopen) ws.onopen({ type: 'open' });
      ws._push(state);
    }, 0);
  }
  FakeSocket.prototype._push = function (s) {
    if (this.readyState === 1 && this.onmessage) this.onmessage({ type: 'message', data: JSON.stringify(s) });
  };
  FakeSocket.prototype.send = function () {};
  //: Fermer ne rappelle PAS onclose : l'app se reconnecterait en boucle.
  FakeSocket.prototype.close = function () {
    this.readyState = 3;
    sockets = sockets.filter(function (x) { return x !== this; }, this);
  };
  FakeSocket.prototype.addEventListener = function (ev, fn) { this['on' + ev] = fn; };
  FakeSocket.prototype.removeEventListener = function () {};
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
  window.WebSocket = FakeSocket;

  addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.id !== id) return;
    if (e.data.type === 'golem-shell:state') {
      state = e.data.state || {};
      sockets.forEach(function (ws) { ws._push(state); });
    }
  });

  // — le stockage —
  function MemStorage(seed) {
    var m = Object.create(null);
    Object.keys(seed || {}).forEach(function (k) { m[k] = String(seed[k]); });
    return {
      get length() { return Object.keys(m).length; },
      key: function (i) { return Object.keys(m)[i] || null; },
      getItem: function (k) { return k in m ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      clear: function () { m = Object.create(null); },
    };
  }
  try {
    Object.defineProperty(window, 'localStorage', { value: MemStorage(cfg.storage), configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: MemStorage(), configurable: true });
  } catch (e) { /* navigateur qui refuse : l'app du rack écrira sous golem.fm, rien de grave */ }

  // — les fichiers que l'app charge sans fetch —
  //: Un `<link>` ou un `<img>` part sans passer par fetch : on réécrit son
  //: adresse AVANT qu'il n'entre dans le document. Seul cas aujourd'hui : la
  //: CSS d'un pack d'animation (designer-model.js `ensurePackCss`), servie par
  //: golem.fm aux mêmes portes que le rack (routes/golem_anim.py).
  var REWRITE = [[/^\/api\/anim-pack\/([^/]+)\/css$/, '/api/golem/anim-packs/$1/css']];
  //: L'adresse à charger à la place d'une adresse `/api/…` de l'app : un asset
  //: (`undefined` = pas une adresse du bridge, `null` = rien à servir).
  function mapUrl(raw) {
    var u = raw && pathOf(raw);
    if (!u || u.origin !== location.origin) return undefined;
    if (!MEDIA_PREFIX.some(function (p) { return u.pathname.indexOf(p) === 0; })) return undefined;
    //: Une image de l'instantané (la pochette de la chanson d'usine) : un
    //: fichier statique recopié par tools/sync_golem_app.py --snapshot.
    //: Un son de l'instantané (une démo, une piste de la prise, un pad de kit) :
    //: même table, sous frontend/public/golem-app/media/.
    var a = (u.search && assets[canon(u.pathname) + canonQuery(u.search)]) || assets[canon(u.pathname)];
    if (a) return a;
    for (var i = 0; i < REWRITE.length; i++) {
      if (REWRITE[i][0].test(u.pathname)) return u.pathname.replace(REWRITE[i][0], REWRITE[i][1]);
    }
    tell({ type: 'golem-shell:miss', method: 'GET', path: u.pathname });
    return null;
  }
  function rewrite(node) {
    if (!node || node.nodeType !== 1) return;
    var attr = node.tagName === 'LINK' ? 'href' : /^(IMG|AUDIO|VIDEO|SOURCE|SCRIPT)$/.test(node.tagName) ? 'src' : null;
    var m = attr ? mapUrl(node.getAttribute(attr)) : undefined;
    if (m) node.setAttribute(attr, m);
    else if (m === null) node.removeAttribute(attr);
  }
  ['appendChild', 'insertBefore'].forEach(function (fn) {
    var orig = Node.prototype[fn];
    Node.prototype[fn] = function (node) { rewrite(node); return orig.apply(this, arguments); };
  });

  //: Un son que l'app crée sans l'insérer dans le document (`new Audio(url)`,
  //: `audio.src = url` : la pré-écoute d'un sample, la démo d'un patch) : même
  //: table. Sans asset, la source reste vide et `play()` échoue comme sur un
  //: fichier absent — l'app sait déjà le dire.
  var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, enumerable: srcDesc.enumerable, get: srcDesc.get,
      set: function (v) { var m = mapUrl(v); srcDesc.set.call(this, m === undefined ? v : m || ''); },
    });
  }
  var RealAudio = window.Audio;
  window.Audio = function Audio(url) { var a = new RealAudio(); if (url !== undefined) a.src = url; return a; };
  window.Audio.prototype = RealAudio.prototype;

  // — ce que le rack ouvre DANS le Designer —
  //: Un patch s'ouvre sur le rack par `openInDesigner(patchDraft(patch))`
  //: (page-patches.js) : le Designer se replie en mode patch. On fait le même
  //: geste, avec le même code, avant que main.js ne monte la page — un module
  //: écrit pendant l'analyse s'exécute avant ceux qui le suivent.
  if (cfg.open && cfg.open.patch) {
    document.write('<script type="module">' +
      "import { openInDesigner } from './lib.js';" +
      "import { patchDraft } from './designer-model.js';" +
      "const c = parent.__golemShell[" + JSON.stringify(id) + "];" +
      "openInDesigner(patchDraft(c.open.patch));" +
      '<\/script>');
  }

  //: Pas de fenêtre à redimensionner, pas d'écran à garder allumé.
  try { window.resizeTo = function () {}; } catch (e) { /* lecture seule */ }

  tell({ type: 'golem-shell:ready' });
})();
