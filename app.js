/* XtreamTV - Xtream Codes API ile çalışan IPTV oynatıcı
 * Eski TV tarayıcıları için ES5 ile yazıldı (Tizen 3+, webOS 3+). */
(function () {
  'use strict';
  var APP_VERSION = '1.4.0';

  function $(s) { return document.querySelector(s); }
  function enc(s) { return encodeURIComponent(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function noop() {}

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('xtv.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('xtv.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  var S = {
    acc: store.get('acc', null),
    info: null,
    section: 'live',
    catId: null,
    lastCat: {},
    cache: {},
    base: [],
    list: [],
    rendered: 0,
    favs: store.get('favs', { live: [], vod: [], series: [] }),
    pos: store.get('pos', {}),
    fmt: store.get('fmt', 'm3u8'),
    seriesView: null,
    zoneFocus: {},
    play: null,
    returnFocus: null,
    minRating: 0,
    searchAll: null,
    sort: store.get('sort', 'default'),
    omdbKey: store.get('omdbKey', ''),
    imdb: store.get('imdb', {}),
    pref: extendPref(store.get('pref', {})),
    os: store.get('os', { key: '', user: '', pass: '', token: '', base: '' }),
    sub: null,
    yt: store.get('yt', { key: '', mine: [] })
  };
  function extendPref(p) {
    var d = { audio: 'tr', subs: 'tr', size: 'm' };
    for (var k in p) d[k] = p[k];
    return d;
  }
  function savePref() { store.set('pref', S.pref); }
  function saveOs() { store.set('os', S.os); }
  var OMDB = window.XTV_OMDB || 'https://www.omdbapi.com/';
  var MIN_STEPS = [0, 5, 6, 7, 7.5, 8];
  var SORTS = ['default', 'rating', 'new', 'az'];
  var SORT_LABEL = { 'default': 'Sağlayıcı sırası', rating: 'En yüksek puan', 'new': 'En yeni eklenen', az: 'A-Z' };

  var TITLES = { live: 'Canlı TV', vod: 'Filmler', series: 'Diziler', settings: 'Ayarlar' };
  var CAT_ACTION = { live: 'get_live_categories', vod: 'get_vod_categories', series: 'get_series_categories' };
  var LIST_ACTION = { live: 'get_live_streams', vod: 'get_vod_streams', series: 'get_series' };
  var BATCH = 120;

  /* ---------------- Ağ ---------------- */
  function getJSON(url, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = timeout || 30000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText)); }
          catch (e) { reject(new Error('Sunucu geçerli bir yanıt vermedi. Adresin doğru olduğundan emin ol.')); }
        } else {
          reject(new Error('Sunucu hata döndürdü (' + x.status + ').'));
        }
      };
      x.onerror = function () { reject(new Error('Sunucuya ulaşılamadı. Adresi, portu ve internet bağlantısını kontrol et.')); };
      x.ontimeout = function () { reject(new Error('Sunucu ' + Math.round((timeout || 30000) / 1000) + ' saniye içinde yanıt vermedi. Tekrar dene ya da bir kategori seç.')); };
      x.send();
    });
  }

  function api(action, params) {
    var u = S.acc.server + '/player_api.php?username=' + enc(S.acc.user) + '&password=' + enc(S.acc.pass);
    if (action) u += '&action=' + action;
    if (params) for (var k in params) u += '&' + k + '=' + enc(params[k]);
    // Film ve dizi listeleri binlerce kayıt içerebilir; bunlara daha uzun süre tanı
    return getJSON(u, /^get_(vod_streams|series|live_streams)$/.test(action || '') ? 90000 : 30000);
  }

  function normServer(s) {
    s = (s || '').trim().replace(/\/+$/, '').replace(/\/player_api\.php.*$/i, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  function streamUrl(type, it) {
    var p = S.acc.server + '/' + ({ live: 'live', vod: 'movie', episode: 'series' }[type]) +
      '/' + enc(S.acc.user) + '/' + enc(S.acc.pass) + '/';
    if (type === 'live') return p + it.stream_id + '.' + S.fmt;
    if (type === 'vod') return p + it.stream_id + '.' + (it.container_extension || 'mp4');
    return p + it.id + '.' + (it.container_extension || 'mp4');
  }

  function b64(s) {
    if (!s) return '';
    try { return decodeURIComponent(escape(atob(s))); } catch (e) {
      try { return atob(s); } catch (e2) { return s; }
    }
  }

  /* ---------------- Yardımcılar ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3000);
  }

  function showScreen(id) {
    ['login', 'main', 'player'].forEach(function (s) {
      $('#' + s).className = 'screen' + (s === id ? '' : ' hidden') + (s === 'main' && S.section === 'settings' ? ' no-cats' : '');
    });
  }
  function currentScreen() {
    if (!$('#player').classList.contains('hidden')) return 'player';
    if (!$('#main').classList.contains('hidden')) return 'main';
    return 'login';
  }

  function loginMsg(text, err) {
    var m = $('#login-msg');
    m.textContent = text || '';
    m.className = 'msg' + (err ? ' err' : '');
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }

  /* ---------------- Uzaktan kumanda ile gezinme ---------------- */
  function focusables() {
    var name = currentScreen(), scr = $('#' + name);
    if (name === 'player') scr = P.layer === 'guide' ? $('#guide') : P.layer === 'menu' ? $('#pmenu') : $('#pbar');
    else if (name === 'main' && D.open) scr = $('#detail');
    var all = scr.querySelectorAll('.f'), out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null && !all[i].disabled) out.push(all[i]);
    }
    return out;
  }

  function zoneOf(el) {
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-zone')) return el.getAttribute('data-zone');
      el = el.parentNode;
    }
    return null;
  }

  function scrollParent(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      if (/^(items|cat-list|settings|g-cats|g-items|pmenu-list)$/.test(p.id)) return p;
      p = p.parentNode;
    }
    return null;
  }

  function focusEl(el) {
    if (!el) return;
    el.focus();
    var sp = scrollParent(el);
    if (!sp) return;
    var top = el.offsetTop, bottom = top + el.offsetHeight, margin = el.offsetHeight;
    if (top - margin < sp.scrollTop) sp.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > sp.scrollTop + sp.clientHeight) sp.scrollTop = bottom + margin - sp.clientHeight;
  }

  function move(dir) {
    var list = focusables();
    var cur = document.activeElement;
    if (list.indexOf(cur) < 0) { focusEl(list[0]); return; }
    var r = cur.getBoundingClientRect();
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var b = el.getBoundingClientRect(), main, cross, overlap;
      if (dir === 'right' || dir === 'left') {
        main = dir === 'right' ? b.left - r.right : r.left - b.right;
        overlap = b.top < r.bottom && b.bottom > r.top;
        cross = overlap ? 0 : Math.min(Math.abs(b.top - r.bottom), Math.abs(r.top - b.bottom));
      } else {
        main = dir === 'down' ? b.top - r.bottom : r.top - b.bottom;
        overlap = b.left < r.right && b.right > r.left;
        cross = overlap ? Math.abs((b.left - r.left)) * 0.1 : Math.min(Math.abs(b.left - r.right), Math.abs(r.left - b.right)) + 50;
      }
      if (main < -2) continue;
      var score = Math.max(0, main) + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return;
    // Başka bir bölgeye geçerken o bölgede en son bulunulan yere dön
    var z = zoneOf(best);
    if (z && z !== zoneOf(cur) && (dir === 'left' || dir === 'right')) {
      var remembered = S.zoneFocus[z];
      if (remembered && list.indexOf(remembered) >= 0) best = remembered;
    }
    focusEl(best);
  }

  document.addEventListener('focusin', function (e) {
    var z = zoneOf(e.target);
    if (z) S.zoneFocus[z] = e.target;
  });

  /* ---------------- Giriş ---------------- */
  function authOk(d) { return d && d.user_info && String(d.user_info.auth) === '1'; }
  function lowerFirst(s) { return s ? s.charAt(0).toLocaleLowerCase('tr') + s.slice(1) : s; }

  function doLogin(acc) {
    S.acc = acc;
    loginMsg('Bağlanılıyor…');
    return api().then(function (d) {
      if (authOk(d)) return d;
      // TV klavyeleri ilk harfi kendiliğinden büyütebiliyor: küçük harfle bir kez daha dene
      var alt = { server: acc.server, user: lowerFirst(acc.user), pass: lowerFirst(acc.pass) };
      if (alt.user === acc.user && alt.pass === acc.pass) return d;
      S.acc = alt;
      return api().then(function (d2) {
        if (authOk(d2)) {
          acc = alt;
          $('#in-user').value = alt.user; $('#in-pass').value = alt.pass;
          return d2;
        }
        S.acc = acc;
        return d;
      });
    }).then(function (d) {
      if (!authOk(d)) {
        var msg = d && d.user_info && d.user_info.message ? ' Sunucu mesajı: ' + d.user_info.message : '';
        throw new Error('Sunucu bu kullanıcı adı ve şifreyi kabul etmedi. “Şifreyi göster” ile yazdığını harf harf kontrol et; büyük-küçük harf farkı önemli.' + msg);
      }
      if (d.user_info.status && d.user_info.status !== 'Active') throw new Error('Hesap aktif değil (durum: ' + d.user_info.status + ').');
      S.info = d;
      store.set('acc', acc);
      var fm = d.user_info.allowed_output_formats;
      if (fm && fm.length && fm.indexOf(S.fmt) < 0) S.fmt = fm.indexOf('m3u8') >= 0 ? 'm3u8' : fm[0];
      loginMsg('');
      S.section = 'live';
      showScreen('main');
      openSection('live', true);
    }).catch(function (e) {
      showScreen('login');
      loginMsg(e.message, true);
      focusEl($('#btn-login'));
    });
  }

  $('#btn-login').addEventListener('click', function () {
    var acc = {
      server: normServer($('#in-server').value),
      user: $('#in-user').value.trim(),
      pass: $('#in-pass').value.trim()
    };
    if (!acc.server || !acc.user || !acc.pass) { loginMsg('Üç alanı da doldur.', true); return; }
    doLogin(acc);
  });

  $('#btn-showpass').addEventListener('click', function () {
    var inp = $('#in-pass'), show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    this.textContent = show ? 'Şifreyi gizle' : 'Şifreyi göster';
  });

  /* ---------------- Bölümler ve kategoriler ---------------- */
  function cached(key, loader) {
    if (S.cache[key]) return Promise.resolve(S.cache[key]);
    return loader().then(function (d) { S.cache[key] = d; return d; });
  }

  function openSection(sec, focusRail) {
    S.section = sec;
    S.seriesView = null;
    var rail = document.querySelectorAll('.rail-item');
    for (var i = 0; i < rail.length; i++) {
      rail[i].classList.toggle('active', rail[i].getAttribute('data-section') === sec);
      if (focusRail && rail[i].getAttribute('data-section') === sec) focusEl(rail[i]);
    }
    $('#main').classList.toggle('no-cats', sec === 'settings');
    $('#items').classList.toggle('hidden', sec === 'settings');
    $('#search').classList.toggle('hidden', sec === 'settings');
    $('#settings').classList.toggle('hidden', sec !== 'settings');
    $('#hints').classList.toggle('hidden', sec === 'settings');
    $('#content-count').textContent = '';
    updateFilterButtons();
    heroItem = null;
    $('#hero').classList.add('hidden');

    if (sec === 'settings') { $('#content-title').textContent = 'Ayarlar'; renderSettings(); return; }

    $('#cats-title').textContent = 'Kategoriler';
    $('#cat-list').innerHTML = '<p class="empty">Yükleniyor…</p>';
    $('#items').innerHTML = '';
    $('#content-title').textContent = TITLES[sec];

    cached('cats|' + sec, function () { return api(CAT_ACTION[sec]); }).then(function (cats) {
      if (S.section !== sec) return;
      var list = [{ category_id: 'fav', category_name: 'Favoriler' }, { category_id: '*', category_name: 'Tümü' }];
      list = list.concat(Array.isArray(cats) ? cats : []);
      $('#cat-list').innerHTML = list.map(function (c) {
        return '<button class="f cat" data-cat="' + esc(c.category_id) + '">' + esc(c.category_name) + '</button>';
      }).join('');
      openCat(S.lastCat[sec] || (S.favs[sec].length ? 'fav' : '*'));
    }).catch(function (e) {
      $('#cat-list').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function loadList(sec, catId) {
    var all = catId === '*' || catId === 'fav';
    return cached('list|' + sec + '|' + (all ? '*' : catId), function () {
      return api(LIST_ACTION[sec], all ? null : { category_id: catId });
    });
  }

  function openCat(catId) {
    var sec = S.section;
    S.catId = catId;
    S.lastCat[sec] = catId;
    var btns = document.querySelectorAll('#cat-list .cat'), name = '';
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-cat') === String(catId);
      btns[i].classList.toggle('active', on);
      if (on) { name = btns[i].textContent; S.zoneFocus.cats = btns[i]; }
    }
    $('#content-title').textContent = name || TITLES[sec];
    $('#content-count').textContent = '';
    $('#search').value = '';
    $('#items').className = sec === 'live' ? 'rows' : 'grid';
    $('#items').innerHTML = '<p class="empty">Yükleniyor…</p>';
    S.zoneFocus.items = null;

    loadList(sec, catId).then(function (arr) {
      if (S.section !== sec || S.catId !== catId || S.seriesView) return;
      arr = Array.isArray(arr) ? arr : [];
      if (catId === 'fav') {
        var ids = S.favs[sec];
        arr = arr.filter(function (it) { return ids.indexOf(String(idOf(sec, it))) >= 0; });
      }
      S.base = arr;
      applyFilter();
    }).catch(function (e) {
      $('#items').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function idOf(sec, it) { return sec === 'series' ? it.series_id : it.stream_id; }
  function isFav(sec, it) { return S.favs[sec].indexOf(String(idOf(sec, it))) >= 0; }

  /* ---------------- Puanlar (sağlayıcı + IMDb) ---------------- */
  function providerRating(it) {
    var r = parseFloat(it.rating);
    if (!(r > 0)) { var r5 = parseFloat(it.rating_5based); if (r5 > 0) r = r5 * 2; }
    if (!(r > 0)) return 0;
    if (r > 10) r = r / 10;
    return Math.round(r * 10) / 10;
  }
  function imdbKey(sec, it) { return sec + '|' + idOf(sec, it); }
  // IMDb puanı alınmışsa onu, yoksa sağlayıcının verdiği puanı kullan
  function ratingOf(sec, it) {
    var v = S.imdb[imdbKey(sec, it)];
    if (v > 0) return { v: v, imdb: true };
    return { v: providerRating(it), imdb: false };
  }
  function badgeHtml(sec, it) {
    var r = ratingOf(sec, it);
    if (!r.v) return '';
    return '<span class="rate' + (r.imdb ? ' imdb' : '') + (r.v < 5 ? ' low' : '') + '">' +
      (r.imdb ? 'IMDb ' : '★ ') + r.v.toFixed(1) + '</span>';
  }
  function addedOf(it) { return +(it.added || it.last_modified || 0); }

  function filtersVisible() { return S.section === 'vod' || S.section === 'series'; }
  function updateFilterButtons() {
    var show = filtersVisible() && !S.seriesView;
    $('#filters').classList.toggle('hidden', !show);
    $('#btn-min').textContent = S.minRating ? 'Puan: ' + S.minRating + ' ve üzeri' : 'Puan: tümü';
    $('#btn-min').classList.toggle('on', S.minRating > 0);
    $('#btn-sort').textContent = SORT_LABEL[S.sort];
    $('#btn-sort').classList.toggle('on', S.sort !== 'default');
  }
  $('#btn-min').addEventListener('click', function () {
    S.minRating = MIN_STEPS[(MIN_STEPS.indexOf(S.minRating) + 1) % MIN_STEPS.length];
    updateFilterButtons(); applyFilter();
  });
  $('#btn-sort').addEventListener('click', function () {
    S.sort = SORTS[(SORTS.indexOf(S.sort) + 1) % SORTS.length];
    store.set('sort', S.sort);
    updateFilterButtons(); applyFilter();
  });

  function normText(t) {
    return String(t || '').toLocaleLowerCase('tr').replace(/[.:_\-|()\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function applyFilter() {
    var q = normText($('#search').value);
    var sec = S.section, rated = filtersVisible();
    // Arama, seçili kategoriyle sınırlı kalmasın: tüm bölüm içinde ara
    var source = q && S.searchAll && S.searchAll.sec === sec ? S.searchAll.list : S.base;
    var words = q ? q.split(' ') : [];
    var list = !q ? source.slice() : source.filter(function (it) {
      var n = normText(it.name);
      for (var w = 0; w < words.length; w++) if (n.indexOf(words[w]) < 0) return false;
      return true;
    });
    if (rated && S.minRating > 0) {
      list = list.filter(function (it) { return ratingOf(sec, it).v >= S.minRating; });
    }
    if (rated && S.sort === 'rating') list.sort(function (a, b) { return ratingOf(sec, b).v - ratingOf(sec, a).v; });
    else if (rated && S.sort === 'new') list.sort(function (a, b) { return addedOf(b) - addedOf(a); });
    else if (rated && S.sort === 'az') list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'tr'); });
    S.list = list;
    S.rendered = 0;
    $('#items').innerHTML = '';
    var total = source.length;
    if (!S.seriesView) {
      var catBtn = $('#cat-list .cat.active');
      $('#content-title').textContent = q ? '“' + $('#search').value.trim() + '” araması' : (catBtn ? catBtn.textContent : TITLES[sec]);
    }
    $('#content-count').textContent = !list.length ? '' : list.length === total ? total : list.length + ' / ' + total;
    if (!S.list.length) {
      $('#items').innerHTML = '<p class="empty">' + (
        q ? '“' + esc(q) + '” ile eşleşen içerik yok' + (rated && S.minRating > 0 ? ' (puan filtresi açık)' : '') + '.' :
        rated && S.minRating > 0 && total ? S.minRating + ' ve üzeri puanlı içerik yok. Yukarıdaki puan filtresini düşür.' :
        S.catId === 'fav' ? 'Henüz favori yok. Bir içeriğin üzerindeyken kumandadaki kırmızı tuşa (klavyede F) bas.' :
        'Bu kategoride içerik yok.') + '</p>';
      return;
    }
    renderMore();
    if (heroVisible()) heroUpdate(sec, S.list[0]);
  }

  var searchTimer;
  $('#search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var sec = S.section;
      if (!$('#search').value.trim() || sec === 'settings') { applyFilter(); return; }
      if (S.searchAll && S.searchAll.sec === sec) { applyFilter(); return; }
      loadList(sec, '*').then(function (all) {
        S.searchAll = { sec: sec, list: Array.isArray(all) ? all : [] };
        if (S.section === sec) applyFilter();
      }).catch(function () { applyFilter(); });
    }, 300);
  });

  function itemHtml(sec, it, i) {
    var fav = isFav(sec, it) ? ' fav' : '';
    if (sec === 'live') {
      var logo = it.stream_icon ? '<img class="logo" src="' + esc(it.stream_icon) + '" onerror="this.style.visibility=\'hidden\'">' : '<span class="logo"></span>';
      return '<button class="f item' + fav + '" data-i="' + i + '"><span class="num">' + esc(it.num || i + 1) + '</span>' +
        logo + '<span class="name">' + esc(it.name) + '</span></button>';
    }
    var img = sec === 'series' ? it.cover : it.stream_icon;
    return '<button class="f item' + fav + '" data-i="' + i + '"><div class="poster"><span class="ph">' + esc(it.name) + '</span>' +
      (img ? '<img src="' + esc(img) + '" loading="lazy" onerror="this.remove()">' : '') +
      badgeHtml(sec, it) + '</div><span class="name">' + esc(it.name) + '</span></button>';
  }

  function renderMore() {
    var end = Math.min(S.list.length, S.rendered + BATCH), html = '';
    for (var i = S.rendered; i < end; i++) html += itemHtml(S.section, S.list[i], i);
    $('#items').insertAdjacentHTML('beforeend', html);
    S.rendered = end;
  }

  $('#items').addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest('.item');
    if (!el || S.seriesView) return;
    var i = +el.getAttribute('data-i');
    if (i > S.rendered - 20 && S.rendered < S.list.length) renderMore();
    queueImdb(i);
    heroUpdate(S.section, S.list[i]);
  });

  $('#items').addEventListener('scroll', function () {
    var el = this;
    if (S.seriesView || S.rendered >= S.list.length) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 800) renderMore();
  });

  $('#rail').addEventListener('click', function (e) {
    var b = e.target.closest('.rail-item');
    if (b) openSection(b.getAttribute('data-section'), true);
  });

  $('#cat-list').addEventListener('click', function (e) {
    var b = e.target.closest('.cat');
    if (!b) return;
    if (S.seriesView) {
      if (b.getAttribute('data-back')) closeSeries();
      else showSeason(b.getAttribute('data-season'));
      return;
    }
    openCat(b.getAttribute('data-cat'));
  });

  $('#items').addEventListener('click', function (e) {
    var b = e.target.closest('.item');
    if (!b) return;
    var i = +b.getAttribute('data-i');
    if (S.seriesView) { startPlayback(S.seriesView.eps, i, 'episode', { name: S.seriesView.series.name, info: S.seriesView.info }); return; }
    var it = S.list[i];
    if (S.section === 'live') startPlayback(S.list, i, 'live');
    else openDetail(S.section, it, b);
  });

  function toggleFav() {
    var el = document.activeElement;
    if (!el || !el.classList.contains('item') || S.seriesView) return;
    var sec = S.section, it = S.list[+el.getAttribute('data-i')];
    if (!it) return;
    var id = String(idOf(sec, it)), arr = S.favs[sec], k = arr.indexOf(id);
    if (k >= 0) { arr.splice(k, 1); toast(it.name + ' favorilerden çıkarıldı'); }
    else { arr.push(id); toast(it.name + ' favorilere eklendi'); }
    el.classList.toggle('fav', k < 0);
    store.set('favs', S.favs);
  }

  /* ---------------- IMDb (OMDb API, isteğe bağlı) ----------------
   * Sağlayıcı puanı çoğu panelde TMDB'den gelir. OMDb anahtarı girilirse
   * ekranda gezilen içeriklerin gerçek IMDb puanı alınıp cihazda saklanır. */
  var omdbQueue = [], omdbPending = {}, omdbBusy = 0, omdbStopped = false, imdbSaveTimer;

  function cleanTitle(n) {
    var t = String(n || '');
    t = t.replace(/^\s*(\[[^\]]*\]|\|[^|]*\||[A-Z]{2,3}\s*[:|]|[A-Z]{2,3}\s+-)\s*/, '');
    t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\(\s*(19|20)\d{2}\s*\)/g, ' ');
    t = t.replace(/\b(4K|UHD|FHD|HD|SD|HEVC|H\.?265|x265|1080p|720p|2160p|MULTI|DUAL|TR ?DUB|DUBLAJ|ALTYAZI(LI)?)\b/gi, ' ');
    t = t.replace(/\s[-–|]\s*(19|20)\d{2}\s*$/, ' ');
    return t.replace(/\s+/g, ' ').replace(/[\s\-–|:]+$/, '').trim();
  }
  function yearOf(it, info) {
    var m = String(it.name || '').match(/\((19|20)\d{2}\)|\s[-–]\s*((19|20)\d{2})\s*$/);
    if (m) return (m[0].match(/(19|20)\d{2}/) || [])[0];
    var d = (info && (info.releasedate || info.releaseDate || info.release_date)) || it.year || it.releaseDate || '';
    return (String(d).match(/(19|20)\d{2}/) || [])[0] || '';
  }

  function omdb(params) {
    var u = OMDB + '?apikey=' + enc(S.omdbKey);
    for (var k in params) if (params[k]) u += '&' + k + '=' + enc(params[k]);
    return getJSON(u).then(function (d) {
      if (d && d.Response === 'False' && /api key|limit/i.test(d.Error || '')) {
        omdbStopped = true;
        toast(/limit/i.test(d.Error) ? 'OMDb günlük sorgu sınırı doldu. IMDb puanları yarın devam eder.' : 'OMDb anahtarı geçersiz. Ayarlar’dan kontrol et.');
        throw new Error('stop');
      }
      var r = d && parseFloat(d.imdbRating);
      return r > 0 ? r : 0;
    });
  }

  function lookupImdb(job) {
    var type = job.sec === 'vod' ? 'movie' : 'series';
    var title = cleanTitle(job.it.name), year = yearOf(job.it);
    return omdb({ t: title, y: year, type: type }).then(function (r) {
      if (r) return r;
      // Bulunamadıysa sağlayıcıdan orijinal adı / IMDb kimliğini al ve tekrar dene
      if (job.sec !== 'vod') return year ? omdb({ t: title, type: type }) : 0;
      return api('get_vod_info', { vod_id: job.it.stream_id }).then(function (d) {
        var info = (d && d.info) || {};
        var imdbId = info.imdb_id || (String(info.imdb_url || '').match(/tt\d+/) || [])[0];
        if (imdbId) return omdb({ i: imdbId });
        var o = cleanTitle(info.o_name || info.original_name || '');
        if (o && o !== title) return omdb({ t: o, y: yearOf({}, info), type: type });
        return year ? omdb({ t: title, type: type }) : 0;
      });
    });
  }

  function queueImdb(from) {
    if (!S.omdbKey || omdbStopped || !filtersVisible() || S.seriesView) return;
    // Yeni bir yere gelindiyse eski istekleri bırak, odaktaki ve sonraki birkaç içeriğe öncelik ver
    omdbQueue = [];
    for (var i = Math.max(0, from - 2); i < Math.min(S.list.length, from + 12); i++) {
      var it = S.list[i], k = imdbKey(S.section, it);
      if (S.imdb[k] === undefined && !omdbPending[k]) omdbQueue.push({ k: k, sec: S.section, it: it });
    }
    pumpImdb();
  }

  function pumpImdb() {
    while (omdbBusy < 2 && omdbQueue.length && !omdbStopped) {
      (function (job) {
        omdbBusy++; omdbPending[job.k] = true;
        lookupImdb(job).then(function (r) { finishImdb(job, r); }, function (e) {
          if (e && e.message !== 'stop') finishImdb(job, 0);
        }).then(function () {
          omdbBusy--; delete omdbPending[job.k]; pumpImdb();
        });
      })(omdbQueue.shift());
    }
  }

  function finishImdb(job, r) {
    S.imdb[job.k] = Math.round((r || 0) * 10) / 10;
    clearTimeout(imdbSaveTimer);
    imdbSaveTimer = setTimeout(function () { store.set('imdb', S.imdb); }, 1500);
    if (S.section !== job.sec || S.seriesView) return;
    var idx = S.list.indexOf(job.it);
    var el = idx >= 0 && $('#items .item[data-i="' + idx + '"] .poster');
    if (!el) return;
    var old = el.querySelector('.rate');
    if (old) el.removeChild(old);
    el.insertAdjacentHTML('beforeend', badgeHtml(job.sec, job.it));
  }

  /* ---------------- Vitrin: odaktaki film / dizinin görseli ve konusu ---------------- */
  var heroTimer, heroItem = null;
  function heroVisible() { return (S.section === 'vod' || S.section === 'series') && !S.seriesView; }
  function heroUpdate(sec, it) {
    $('#hero').classList.toggle('hidden', !heroVisible());
    if (!heroVisible() || !it || it === heroItem) return;
    heroItem = it;
    clearTimeout(heroTimer);
    var rt = ratingOf(sec, it);
    $('#h-title').textContent = cleanTitle(it.name) || it.name;
    var meta = (rt.v ? '<span class="h-rate">' + (rt.imdb ? 'IMDb ' : '★ ') + rt.v.toFixed(1) + '</span>' : '');
    var y = yearOf(it); if (y) meta += '<span>' + y + '</span>';
    $('#h-meta').innerHTML = meta;
    $('#h-plot').textContent = '';
    var img = sec === 'series' ? it.cover : it.stream_icon;
    $('#hero .h-bg').style.backgroundImage = img ? 'url("' + String(img).replace(/"/g, '%22') + '")' : 'none';
    $('#hero').classList.add('soft');
    // Sağlayıcıdan arka plan görseli ve konuyu, kumanda bir öğede durunca al
    heroTimer = setTimeout(function () {
      detailInfo(sec, it).then(function (d) {
        if (heroItem !== it) return;
        var info = (d && d.info) || {};
        var bg = firstImg(info.backdrop_path);
        if (bg) { $('#hero .h-bg').style.backgroundImage = 'url("' + String(bg).replace(/"/g, '%22') + '")'; $('#hero').classList.remove('soft'); }
        var extra = [fmtDuration(info), info.genre].filter(Boolean);
        if (!yearOf(it) && yearOf({}, info)) extra.unshift(yearOf({}, info));
        $('#h-meta').innerHTML += extra.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
        $('#h-plot').textContent = info.plot || info.description || '';
      }).catch(noop);
    }, 450);
  }

  /* ---------------- Film / dizi bilgi sayfası ---------------- */
  var D = { open: false, it: null, sec: null, fromEl: null };

  function fmtDuration(info) {
    var s = +info.duration_secs || 0;
    if (!s && info.duration) {
      var p = String(info.duration).split(':');
      if (p.length === 3) s = (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
      else if (/^\d+$/.test(info.duration)) s = +info.duration * 60;
    }
    if (!s && +info.episode_run_time) s = +info.episode_run_time * 60;
    if (!s) return '';
    var h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60);
    return (h ? h + ' sa ' : '') + (m ? m + ' dk' : '');
  }
  function firstImg(v) { return Array.isArray(v) ? (v[0] || '') : (v || ''); }
  function shortList(s, n) {
    var a = String(s || '').split(/\s*,\s*/).filter(Boolean);
    return a.length > n ? a.slice(0, n).join(', ') + ' ve diğerleri' : a.join(', ');
  }

  function detailInfo(sec, it) {
    return sec === 'vod'
      ? cached('vodinfo|' + it.stream_id, function () { return api('get_vod_info', { vod_id: it.stream_id }); })
      : cached('seriesinfo|' + it.series_id, function () { return api('get_series_info', { series_id: it.series_id }); });
  }

  function openDetail(sec, it, fromEl) {
    D.open = true; D.sec = sec; D.it = it; D.fromEl = fromEl;
    $('#detail').classList.remove('hidden');
    renderDetail({}, 'loading');
    detailInfo(sec, it).then(function (d) {
      if (D.open && D.it === it) renderDetail((d && d.info) || {});
    }).catch(function (e) {
      if (D.open && D.it === it) renderDetail({}, e.message);
    });
  }

  function closeDetail() {
    D.open = false;
    $('#detail').classList.add('hidden');
    $('#detail').innerHTML = '';
    if (D.fromEl && document.body.contains(D.fromEl)) focusEl(D.fromEl);
  }

  function renderDetail(info, state) {
    var it = D.it, sec = D.sec, keepFocus = document.activeElement && document.activeElement.getAttribute('data-act');
    var title = info.name || it.name;
    var orig = info.o_name || info.original_name || '';
    var rt = ratingOf(sec, it), ir = parseFloat(info.rating);
    var rating = rt.v ? (rt.imdb ? 'IMDb ' : '★ ') + rt.v.toFixed(1) : ir > 0 ? '★ ' + (ir > 10 ? ir / 10 : ir).toFixed(1) : '';
    var meta = [yearOf(it, info), fmtDuration(info), info.genre, info.country].filter(Boolean);
    var plot = info.plot || info.description || '';
    var cast = info.cast || info.actors || '';
    var director = info.director || '';
    var poster = info.movie_image || info.cover_big || info.cover || it.stream_icon || it.cover || '';
    var bg = firstImg(info.backdrop_path) || poster;

    var acts = [];
    if (sec === 'vod') {
      var pos = S.pos['vod|' + it.stream_id];
      if (pos) acts.push(['resume', 'Devam et (' + dur(pos) + ')'], ['start', 'Baştan izle']);
      else acts.push(['play', 'İzle']);
    } else {
      acts.push(['episodes', 'Bölümler']);
    }
    acts.push(['fav', isFav(sec, it) ? 'Favorilerden çıkar' : 'Favorilere ekle']);

    var people = '';
    if (director) people += '<div class="d-row"><span>Yönetmen</span>' + esc(shortList(director, 3)) + '</div>';
    if (cast) people += '<div class="d-row"><span>Oyuncular</span>' + esc(shortList(cast, 8)) + '</div>';

    $('#detail').innerHTML =
      (bg ? '<div class="d-bg" style="background-image:url(\'' + esc(bg).replace(/'/g, '%27') + '\')"></div>' : '') +
      '<div class="d-shade"></div>' +
      '<div class="d-body">' +
        '<div class="d-poster">' + (poster ? '<img src="' + esc(poster) + '" onerror="this.remove()">' : '') + '</div>' +
        '<div class="d-text">' +
          '<h1>' + esc(title) + '</h1>' +
          (orig && orig !== title ? '<div class="d-orig">' + esc(orig) + '</div>' : '') +
          '<div class="d-meta">' + (rating ? '<span class="d-rate">' + esc(rating) + '</span>' : '') +
            meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>' +
          '<p class="d-plot">' + (state === 'loading' ? 'Bilgiler yükleniyor…' : state ? esc(state) : plot ? esc(plot) : 'Sağlayıcı bu içerik için konu bilgisi göndermiyor.') + '</p>' +
          people +
          '<div class="d-actions">' + acts.map(function (a, i) {
            return '<button class="f btn' + (i === 0 ? ' primary' : '') + '" data-act="' + a[0] + '">' + a[1] + '</button>';
          }).join('') + '</div>' +
          '<div class="d-hint">Geri: listeye dön     Kırmızı: favori</div>' +
        '</div>' +
      '</div>';
    focusEl((keepFocus && $('#detail [data-act="' + keepFocus + '"]')) || $('#detail .d-actions .btn'));
  }

  function detailFav() {
    var sec = D.sec, it = D.it, id = String(idOf(sec, it)), arr = S.favs[sec], k = arr.indexOf(id);
    if (k >= 0) { arr.splice(k, 1); toast(it.name + ' favorilerden çıkarıldı'); }
    else { arr.push(id); toast(it.name + ' favorilere eklendi'); }
    store.set('favs', S.favs);
    if (D.fromEl) D.fromEl.classList.toggle('fav', k < 0);
    var b = $('#detail [data-act="fav"]');
    if (b) b.textContent = k < 0 ? 'Favorilerden çıkar' : 'Favorilere ekle';
  }

  $('#detail').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || !D.open) return;
    var act = b.getAttribute('data-act'), it = D.it, from = D.fromEl;
    if (act === 'fav') { detailFav(); return; }
    closeDetail();
    if (act === 'episodes') { openSeries(it, from); return; }
    if (act === 'start') { delete S.pos['vod|' + it.stream_id]; store.set('pos', S.pos); }
    var idx = S.list.indexOf(it);
    if (idx < 0) return;
    startPlayback(S.list, idx, 'vod');
  });

  /* ---------------- Diziler ---------------- */
  function openSeries(series, fromEl) {
    toast('Bölümler yükleniyor…');
    cached('seriesinfo|' + series.series_id, function () { return api('get_series_info', { series_id: series.series_id }); }).then(function (d) {
      var eps = (d && d.episodes) || {};
      var seasons = Object.keys(eps).sort(function (a, b) { return a - b; });
      if (!seasons.length) { toast('Bu dizi için bölüm bulunamadı.'); return; }
      $('#toast').className = '';
      seasons.forEach(function (s) {
        (eps[s] || []).forEach(function (ep) { if (ep._season == null) ep._season = ep.season != null && ep.season !== '' ? ep.season : s; });
      });
      S.seriesView = { series: series, all: eps, eps: [], fromEl: fromEl, info: (d && d.info) || {} };
      updateFilterButtons();
      $('#hero').classList.add('hidden'); heroItem = null;
      $('#cats-title').textContent = series.name;
      $('#cat-list').innerHTML = '<button class="f cat" data-back="1">‹ Dizilere dön</button>' +
        seasons.map(function (s) { return '<button class="f cat" data-season="' + esc(s) + '">' + esc(s) + '. sezon</button>'; }).join('');
      showSeason(seasons[0], true);
    }).catch(function (e) { toast(e.message); });
  }

  function showSeason(season, focusFirst) {
    var sv = S.seriesView;
    sv.season = season;
    sv.eps = sv.all[season] || [];
    var btns = document.querySelectorAll('#cat-list .cat');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-season') === season);
    $('#content-title').textContent = sv.series.name + ', ' + season + '. sezon';
    $('#content-count').textContent = sv.eps.length;
    $('#items').className = 'rows';
    $('#items').innerHTML = sv.eps.map(function (ep, i) {
      var d = ep.info && (ep.info.duration || (ep.info.duration_secs ? dur(ep.info.duration_secs) : ''));
      var watched = S.pos['episode|' + ep.id] ? ' · yarıda kaldı' : '';
      return '<button class="f item" data-i="' + i + '"><span class="num">' + esc(ep.episode_num || i + 1) + '</span>' +
        '<span class="name">' + esc(ep.title || ('Bölüm ' + (i + 1))) + '</span><span class="meta">' + esc((d || '') + watched) + '</span></button>';
    }).join('');
    S.zoneFocus.items = null;
    if (focusFirst) focusEl($('#items .item'));
  }

  function closeSeries() {
    var from = S.seriesView && S.seriesView.fromEl;
    S.seriesView = null;
    updateFilterButtons();
    var sec = S.section, catId = S.catId, q = $('#search').value;
    $('#cats-title').textContent = 'Kategoriler';
    // Kategori ve listeyi önbellekten yeniden kur
    cached('cats|' + sec, function () { return api(CAT_ACTION[sec]); }).then(function (cats) {
      var list = [{ category_id: 'fav', category_name: 'Favoriler' }, { category_id: '*', category_name: 'Tümü' }].concat(cats || []);
      $('#cat-list').innerHTML = list.map(function (c) {
        return '<button class="f cat" data-cat="' + esc(c.category_id) + '">' + esc(c.category_name) + '</button>';
      }).join('');
      var btns = document.querySelectorAll('#cat-list .cat');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('data-cat') === String(catId)) { btns[i].classList.add('active'); S.zoneFocus.cats = btns[i]; }
      }
      $('#content-title').textContent = S.zoneFocus.cats ? S.zoneFocus.cats.textContent : TITLES[sec];
      $('#search').value = q;
      $('#items').className = 'grid';
      var idx = from ? +from.getAttribute('data-i') : 0;
      $('#items').innerHTML = '';
      S.rendered = 0;
      $('#content-count').textContent = S.list.length === S.base.length ? S.list.length : S.list.length + ' / ' + S.base.length;
      while (S.rendered <= idx && S.rendered < S.list.length) renderMore();
      focusEl($('#items .item[data-i="' + idx + '"]') || $('#items .item'));
    });
  }

  /* ---------------- Ayarlar ---------------- */
  function renderSettings() {
    var u = (S.info && S.info.user_info) || {};
    var exp = u.exp_date ? new Date(u.exp_date * 1000).toLocaleDateString('tr-TR') : 'Sınırsız';
    var fm = u.allowed_output_formats && u.allowed_output_formats.length ? u.allowed_output_formats : ['m3u8', 'ts'];
    var row = function (a, b) { return '<div class="set-row"><span>' + a + '</span><span>' + esc(b) + '</span></div>'; };
    $('#settings').innerHTML =
      '<div class="set-block"><h3>Hesap</h3>' +
        row('Kullanıcı', u.username || S.acc.user) + row('Durum', u.status || '-') +
        row('Bitiş tarihi', exp) + row('Bağlantı', (u.active_cons || 0) + ' / ' + (u.max_connections || '-')) +
        row('Sunucu', S.acc.server) +
        row('Uygulama', APP_VERSION + (window.XTV_SOURCE === 'github' ? ' (GitHub’dan güncel)' : window.XTV_SOURCE === 'cache' ? ' (GitHub’a ulaşılamadı, son indirilen)' : ' (TV’deki kopya)')) +
      '</div>' +
      '<div class="set-block"><h3>Canlı yayın biçimi</h3>' +
        '<p>Kanallar açılmıyor ya da takılıyorsa diğer biçimi dene. TV\'lerde ikisi de genelde çalışır, bilgisayar tarayıcısında HLS gerekir.</p>' +
        fm.map(function (f) {
          return '<button class="f btn opt' + (f === S.fmt ? ' active' : '') + '" data-fmt="' + esc(f) + '">' + (f === 'm3u8' ? 'HLS (m3u8)' : f === 'ts' ? 'MPEG-TS (ts)' : esc(f)) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="set-block"><h3>Ses ve altyazı</h3>' +
        '<p>Film ya da dizi başladığında uygulanır. İzlerken de değiştirebilirsin: filmde yukarı/aşağı, canlı yayında sol/sağ tuşuyla alttaki çubuğu aç.</p>' +
        prefRow('Ses dili', 'audio', [['tr', 'Türkçe varsa Türkçe'], ['orig', 'Dosyanın varsayılanı']]) +
        prefRow('Altyazı', 'subs', [['off', 'Kapalı'], ['tr', 'Türkçe varsa aç'], ['auto', 'Türkçe, yoksa indir']]) +
        prefRow('Yazı boyutu', 'size', [['s', 'Küçük'], ['m', 'Orta'], ['l', 'Büyük']]) +
      '</div>' +
      '<div class="set-block os-inputs"><h3>Altyazı indirme</h3>' +
        '<p>Altyazılar opensubtitles.com’dan indirilir. Sitede ücretsiz bir hesap aç, profilindeki "API consumers" bölümünden yeni bir uygulama oluştur ve verilen API anahtarını buraya yaz. ' +
        'Kullanıcı adı ve şifre isteğe bağlı, ama girersen günlük indirme hakkın artar. İndirilen altyazılar TV’de saklanır; aynı filmi tekrar açınca hakkın harcanmaz.</p>' +
        '<input id="in-os-key" class="f" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="API anahtarı" value="' + esc(S.os.key) + '">' +
        '<input id="in-os-user" class="f" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Kullanıcı adı (isteğe bağlı)" value="' + esc(S.os.user) + '">' +
        '<input id="in-os-pass" class="f" type="password" autocomplete="off" autocapitalize="off" placeholder="Şifre (isteğe bağlı)" value="' + esc(S.os.pass) + '">' +
        '<button class="f btn" id="btn-os">Kaydet ve dene</button>' +
        '<p id="os-status" class="msg"></p>' +
      '</div>' +
      '<div class="set-block os-inputs"><h3>YouTube (çoklu ekran)</h3>' +
        '<p>Çoklu ekranda YouTube araması ve canlı yayınlar için ücretsiz bir YouTube Data API anahtarı gerekir. console.cloud.google.com’da bir proje oluştur, ' +
        '"YouTube Data API v3"ü etkinleştir ve "Kimlik bilgileri" bölümünden bir API anahtarı oluştur. Günlük ücretsiz kota yaklaşık 100 aramaya yeter; hazır kanallardan birini açmak da bir arama sayılır.</p>' +
        '<input id="in-yt-key" class="f" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="YouTube API anahtarı" value="' + esc(S.yt.key) + '">' +
        '<button class="f btn" id="btn-yt">Kaydet ve dene</button>' +
        '<p id="yt-status" class="msg"></p>' +
      '</div>' +
      '<div class="set-block"><h3>IMDb puanları</h3>' +
        '<p>Afişlerdeki ★ puanı sağlayıcının verdiği puandır (çoğunlukla TMDB). Gerçek IMDb puanını görmek için omdbapi.com adresinden ücretsiz bir anahtar al ve buraya yaz. ' +
        'Ücretsiz anahtar günde 1000 sorgu hakkı verir; puanlar gezdiğin içerikler için alınır ve cihazda saklanır. ' +
        'Puan filtresi ve sıralama, IMDb puanı alınmış içeriklerde onu, diğerlerinde sağlayıcı puanını kullanır.</p>' +
        '<input id="in-omdb" class="f" type="text" autocomplete="off" placeholder="OMDb API anahtarı" value="' + esc(S.omdbKey) + '" style="max-width:24rem;margin-bottom:1rem">' +
        '<button class="f btn" id="btn-omdb">Anahtarı kaydet</button>' +
        '<button class="f btn" id="btn-imdb-clear">Kayıtlı IMDb puanlarını sil (' + Object.keys(S.imdb).length + ')</button>' +
      '</div>' +
      '<div class="set-block"><h3>Veriler</h3><p>Sağlayıcı yeni kanal ya da film eklediyse listeleri yenile.</p>' +
        '<button class="f btn" id="btn-refresh">Listeleri yenile</button>' +
        '<button class="f btn" id="btn-logout">Çıkış yap</button></div>';
  }

  function prefRow(label, key, opts) {
    return '<div class="pref-row"><span class="pref-label">' + label + '</span>' + opts.map(function (o) {
      return '<button class="f btn opt' + (S.pref[key] === o[0] ? ' active' : '') + '" data-pref="' + key + '" data-val="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function osStatus(msg, err) { var m = $('#os-status'); if (m) { m.textContent = msg; m.className = 'msg' + (err ? ' err' : ''); } }

  $('#settings').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.getAttribute('data-pref')) {
      var pk = b.getAttribute('data-pref'), pv = b.getAttribute('data-val');
      S.pref[pk] = pv; savePref();
      renderSettings(); focusEl($('#settings [data-pref="' + pk + '"][data-val="' + pv + '"]'));
      return;
    }
    if (b.id === 'btn-yt') {
      S.yt.key = $('#in-yt-key').value.trim(); saveYt();
      var ys = $('#yt-status');
      if (!S.yt.key) { ys.textContent = 'Anahtar silindi.'; ys.className = 'msg'; return; }
      ys.textContent = 'Deneniyor…'; ys.className = 'msg';
      ytChannelId('@tagesschau').then(function () { ys.textContent = 'Anahtar çalışıyor.'; ys.className = 'msg'; })
        .catch(function (err) { ys.textContent = err.message; ys.className = 'msg err'; });
      return;
    }
    if (b.id === 'btn-os') {
      S.os.key = $('#in-os-key').value.trim();
      S.os.user = $('#in-os-user').value.trim();
      S.os.pass = $('#in-os-pass').value;
      S.os.token = ''; S.os.base = '';
      saveOs();
      if (!S.os.key) { osStatus('Anahtar silindi. Altyazı indirme kapalı.'); return; }
      osStatus('Deneniyor…');
      var test = S.os.user && S.os.pass
        ? osLogin().then(function (d) {
            var u = (d && d.user) || {};
            return 'Giriş başarılı.' + (u.allowed_downloads ? ' Günlük indirme hakkın: ' + u.allowed_downloads + '.' : '');
          })
        : osReq('GET', OS_API + '/subtitles?' + osParams({ imdb_id: 111161, languages: 'tr' })).then(function () {
            return 'Anahtar çalışıyor. Hesap bilgisi girmeden de indirebilirsin, ancak günlük hakkın daha düşük olur.';
          });
      test.then(function (m) { osStatus(m); }).catch(function (err) { osStatus(err.message, true); });
      return;
    }
    if (b.getAttribute('data-fmt')) {
      S.fmt = b.getAttribute('data-fmt'); store.set('fmt', S.fmt);
      renderSettings(); focusEl($('#settings [data-fmt="' + S.fmt + '"]'));
      toast('Canlı yayın biçimi: ' + S.fmt);
    } else if (b.id === 'btn-omdb') {
      var key = $('#in-omdb').value.trim();
      if (!key) { S.omdbKey = ''; store.set('omdbKey', ''); toast('OMDb anahtarı kaldırıldı. Sağlayıcı puanları gösterilecek.'); return; }
      toast('Anahtar deneniyor…');
      var prev = S.omdbKey; S.omdbKey = key; omdbStopped = false;
      omdb({ i: 'tt0111161' }).then(function (r) {
        store.set('omdbKey', key);
        toast(r ? 'Anahtar çalışıyor. Filmler ve Diziler’de gezindikçe IMDb puanları gelecek.' : 'Anahtar kaydedildi.');
      }).catch(function (e) {
        if (e.message !== 'stop') toast('OMDb’ye ulaşılamadı: ' + e.message);
        S.omdbKey = prev; omdbStopped = false;
      });
    } else if (b.id === 'btn-imdb-clear') {
      S.imdb = {}; store.set('imdb', S.imdb); renderSettings(); focusEl($('#btn-imdb-clear'));
      toast('Kayıtlı IMDb puanları silindi.');
    } else if (b.id === 'btn-refresh') {
      S.cache = {}; S.searchAll = null; toast('Listeler bir sonraki açılışta sunucudan yeniden alınacak.');
    } else if (b.id === 'btn-logout') {
      store.set('acc', null); S.acc = null; S.cache = {}; S.info = null;
      $('#in-pass').value = '';
      showScreen('login'); loginMsg(''); focusEl($('#in-server'));
    }
  });

  /* ---------------- Oynatıcı ---------------- */
  var video = $('#video'), hls = null, osdTimer, saveTimer = 0, retries = 0;
  // layer: null (izleme) | 'bar' (alt çubuk) | 'menu' (ses/altyazı) | 'guide' (listeler)
  var P = { layer: null, menu: null, menuFrom: null, barBtn: 'guide', audioApplied: false, subsApplied: false, autoTried: false, started: false };

  function startPlayback(list, idx, type, ctx) {
    S.returnFocus = document.activeElement;
    S.play = { list: list, idx: idx, type: type, ctx: ctx || null };
    P.layer = null;
    showScreen('player');
    loadCurrent();
  }

  // Oynatıcıdan çıkmadan başka bir içeriğe geç (listeler paneli)
  function switchPlayback(list, idx, type, ctx) {
    savePos(true);
    S.play = { list: list, idx: idx, type: type, ctx: ctx || null };
    loadCurrent();
  }

  function stopVideo() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
  }

  function posKey() { var p = S.play, it = p.list[p.idx]; return p.type + '|' + (p.type === 'episode' ? it.id : it.stream_id); }

  function savePos(force) {
    if (!S.play || S.play.type === 'live' || !video.duration || !isFinite(video.duration)) return;
    var now = Date.now();
    if (!force && now - saveTimer < 10000) return;
    saveTimer = now;
    var t = video.currentTime, k = posKey();
    if (t > 30 && t < video.duration - 90) S.pos[k] = Math.floor(t); else delete S.pos[k];
    store.set('pos', S.pos);
  }

  function epLabel(ep) {
    var s = ep._season != null ? ep._season : ep.season;
    return (s ? s + '. sezon, ' : '') + (ep.episode_num ? ep.episode_num + '. bölüm' : '');
  }

  function loadCurrent() {
    var p = S.play, it = p.list[p.idx], url = streamUrl(p.type, it);
    stopVideo();
    clearSub();
    retries = 0;
    P.audioApplied = P.subsApplied = P.autoTried = P.started = false;
    $('#spinner').classList.remove('hidden');
    $('#osd-title').textContent = (p.type === 'live' && it.num ? it.num + '   ' : '') + (it.name || it.title || '');
    if (p.type === 'live') $('#osd-sub').textContent = 'Canlı';
    else if (p.type === 'episode') $('#osd-sub').textContent = (p.ctx && p.ctx.name ? p.ctx.name + ', ' : '') + epLabel(it);
    else $('#osd-sub').textContent = 'Film';
    $('#osd-epg').innerHTML = '';
    if (p.type === 'vod') {
      var rt = ratingOf('vod', it);
      if (rt.v) $('#osd-sub').textContent += '     ' + (rt.imdb ? 'IMDb ' : '★ ') + rt.v.toFixed(1);
    }
    $('#osd-progress').classList.toggle('hidden', p.type === 'live');
    $('#osd-hint').textContent = p.type === 'live'
      ? 'OK: kanal listesi     Yukarı / aşağı: kanal değiştir     Sol / sağ: ses, altyazı, çoklu ekran     Geri: çık'
      : 'OK: duraklat     Sol / sağ: 10 sn     Yukarı / aşağı: listeler, ses ve altyazı     Geri: çık';
    $('#osd-bar').style.width = '0';
    $('#osd-time').textContent = '';
    renderBar();

    var isHls = /\.m3u8$/.test(url);
    var nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
    if (isHls && !nativeHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, function (ev, d) {
        if (!d.fatal) return;
        if (retries++ < 3 && d.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (retries < 4 && d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        playError();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { setTimeout(applyTrackPrefs, 200); });
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function () { setTimeout(applyTrackPrefs, 200); });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
    }
    var pr = video.play();
    if (pr && pr.catch) pr.catch(noop);
    showOsd();
    if (p.type === 'live') loadEpg(it);
  }

  function playError() {
    $('#spinner').classList.add('hidden');
    var hint = S.play && S.play.type === 'live'
      ? ' Ayarlar’dan canlı yayın biçimini değiştirmeyi dene.'
      : ' Dosya biçimi bu cihazda desteklenmiyor olabilir.';
    toast('Yayın açılamadı.' + hint);
  }

  video.addEventListener('error', function () { if (S.play && currentScreen() === 'player') playError(); });
  video.addEventListener('waiting', function () { $('#spinner').classList.remove('hidden'); });
  video.addEventListener('playing', function () {
    $('#spinner').classList.add('hidden');
    if (!P.started && S.play) {
      P.started = true;
      applyTrackPrefs();
      setTimeout(function () { applyTrackPrefs(); autoSubs(); }, 1500);
    }
  });
  video.addEventListener('loadedmetadata', function () {
    setTimeout(applyTrackPrefs, 500);
    if (!S.play || S.play.type === 'live') return;
    var saved = S.pos[posKey()];
    if (saved && saved < video.duration - 60) { video.currentTime = saved; toast('Kaldığın yerden devam: ' + dur(saved)); }
  });
  if (video.audioTracks && video.audioTracks.addEventListener) {
    video.audioTracks.addEventListener('addtrack', function () { setTimeout(applyTrackPrefs, 300); });
  }
  if (video.textTracks && video.textTracks.addEventListener) {
    video.textTracks.addEventListener('addtrack', function () { setTimeout(applyTrackPrefs, 300); });
  }
  video.addEventListener('timeupdate', function () {
    if (!S.play || S.play.type === 'live') return;
    var d = video.duration;
    if (d && isFinite(d)) {
      $('#osd-bar').style.width = (video.currentTime / d * 100) + '%';
      $('#osd-time').textContent = dur(video.currentTime) + ' / ' + dur(d);
    }
    savePos(false);
  });
  video.addEventListener('ended', function () {
    if (!S.play) return;
    delete S.pos[posKey()]; store.set('pos', S.pos);
    if (S.play.type === 'episode' && S.play.idx < S.play.list.length - 1) { S.play.idx++; loadCurrent(); toast('Sonraki bölüm'); }
    else closePlayer();
  });

  function loadEpg(it) {
    api('get_short_epg', { stream_id: it.stream_id, limit: 2 }).then(function (d) {
      if (!S.play || S.play.list[S.play.idx] !== it) return;
      var l = (d && d.epg_listings) || [];
      $('#osd-epg').innerHTML = l.slice(0, 2).map(function (e, i) {
        var t = e.start_timestamp ? hhmm(+e.start_timestamp) + '  ' : '';
        return '<div' + (i === 0 ? ' class="now"' : '') + '>' + esc(t + b64(e.title)) + '</div>';
      }).join('');
    }).catch(noop);
  }

  function showOsd() {
    $('#osd').classList.remove('off');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { if (!video.paused && !P.layer) $('#osd').classList.add('off'); }, 5000);
  }

  function togglePause() {
    if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(noop); } else video.pause();
    showOsd();
  }

  function seek(sec) {
    if (!video.duration || !isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + sec));
    showOsd();
  }

  function zap(d) {
    var p = S.play, n = p.list.length;
    p.idx = (p.idx + d + n) % n;
    loadCurrent();
  }

  function hideLayers() {
    $('#pmenu').classList.add('hidden');
    $('#guide').classList.add('hidden');
    $('#player').classList.remove('guide-open');
    P.layer = null; P.menu = null;
  }

  function closePlayer() {
    if (M.on) stopMulti(false);
    savePos(true);
    stopVideo();
    clearSub();
    hideLayers();
    $('#spinner').classList.add('hidden');
    var p = S.play;
    S.play = null;
    showScreen('main');
    var target = S.returnFocus && document.body.contains(S.returnFocus) ? S.returnFocus : null;
    // Ana listeden açılan kanal/bölümde son izlenene odaklan
    if (p && p.type === 'live' && p.list === S.list) {
      while (S.rendered <= p.idx && S.rendered < S.list.length) renderMore();
      target = $('#items .item[data-i="' + p.idx + '"]') || target;
    }
    if (p && p.type === 'episode' && S.seriesView && p.list === S.seriesView.eps) {
      showSeason(S.seriesView.season);
      target = $('#items .item[data-i="' + p.idx + '"]') || target;
    }
    focusEl(target || $('#items .item') || $('.rail-item.active'));
  }

  /* ---------------- Alt çubuk ve katmanlar ---------------- */
  function renderBar() {
    var live = S.play && S.play.type === 'live';
    var btns = [['guide', live ? 'Kanal listesi' : 'Listeler'], ['audio', 'Ses'], ['subs', 'Altyazı']];
    if (live) btns.push(['multi', 'Çoklu ekran']);
    $('#pbar').innerHTML = btns.map(function (b) {
      return '<button class="f pbtn" data-act="' + b[0] + '">' + b[1] + '</button>';
    }).join('');
  }
  $('#pbar').addEventListener('click', function (e) {
    var b = e.target.closest('.pbtn');
    if (!b || !S.play) return;
    var a = P.barBtn = b.getAttribute('data-act');
    if (a === 'guide') openGuide(); else if (a === 'audio') openAudioMenu(); else if (a === 'multi') openMultiMenu(); else openSubsMenu();
  });

  function openBar() {
    P.layer = 'bar';
    showOsd();
    focusEl($('#pbar .pbtn[data-act="' + P.barBtn + '"]') || $('#pbar .pbtn'));
  }

  function closeAll() {
    hideLayers();
    var a = document.activeElement;
    if (a && a.blur) a.blur();
    showOsd();
  }

  // Geri tuşu: menüden alt çubuğa, alt çubuktan izlemeye döner
  function closeLayer() {
    if (P.layer === 'menu' && P.menuFrom === 'bar') {
      $('#pmenu').classList.add('hidden'); P.menu = null;
      openBar();
      return;
    }
    closeAll();
  }

  function openMenu(title, items, note, focusIdx) {
    if (P.layer !== 'menu') P.menuFrom = P.layer;
    if (P.layer === 'guide') { $('#guide').classList.add('hidden'); $('#player').classList.remove('guide-open'); }
    P.layer = 'menu';
    P.menu = { title: title, items: items, note: note || '' };
    $('#pmenu').classList.remove('hidden');
    renderMenu(focusIdx);
    showOsd();
  }

  function renderMenu(focusIdx) {
    var m = P.menu;
    $('#pmenu-title').textContent = m.title;
    $('#pmenu-list').innerHTML = m.items.map(function (it, i) {
      var label = typeof it.label === 'function' ? it.label() : it.label;
      return '<button class="f pm-item' + (it.active ? ' on' : '') + (it.adjust ? ' adj' : '') + '" data-i="' + i + '">' +
        '<span class="pm-label">' + esc(label) + '</span>' + (it.sub ? '<span class="pm-sub">' + esc(it.sub) + '</span>' : '') + '</button>';
    }).join('');
    $('#pmenu-note').textContent = m.note;
    $('#pmenu-note').classList.toggle('hidden', !m.note);
    var target = focusIdx == null ? null : $('#pmenu-list .pm-item[data-i="' + focusIdx + '"]');
    focusEl(target || $('#pmenu-list .pm-item.on') || $('#pmenu-list .pm-item'));
  }

  $('#pmenu-list').addEventListener('click', function (e) {
    var b = e.target.closest('.pm-item');
    if (!b || !P.menu) return;
    var it = P.menu.items[+b.getAttribute('data-i')];
    if (it && it.act) it.act();
  });

  function menuAdjust(dir) {
    var el = document.activeElement;
    if (!P.menu || !el || !el.classList.contains('pm-item')) return false;
    var i = +el.getAttribute('data-i'), it = P.menu.items[i];
    if (!it || !it.adjust) return false;
    it.adjust(dir);
    renderMenu(i);
    return true;
  }

  /* ---------------- Ses ve gömülü altyazı kanalları ---------------- */
  var LANGS = {
    tr: 'Türkçe', tur: 'Türkçe', en: 'İngilizce', eng: 'İngilizce', de: 'Almanca', ger: 'Almanca', deu: 'Almanca',
    fr: 'Fransızca', fre: 'Fransızca', fra: 'Fransızca', es: 'İspanyolca', spa: 'İspanyolca', it: 'İtalyanca', ita: 'İtalyanca',
    ja: 'Japonca', jpn: 'Japonca', zh: 'Çince', chi: 'Çince', zho: 'Çince', ko: 'Korece', kor: 'Korece',
    ru: 'Rusça', rus: 'Rusça', ar: 'Arapça', ara: 'Arapça', pt: 'Portekizce', por: 'Portekizce',
    nl: 'Felemenkçe', dut: 'Felemenkçe', nld: 'Felemenkçe', pl: 'Lehçe', pol: 'Lehçe', hi: 'Hintçe', hin: 'Hintçe'
  };
  function langName(code) {
    var c = String(code || '').toLowerCase().split(/[-_]/)[0];
    return LANGS[c] || (c && c !== 'und' ? c.toUpperCase() : '');
  }
  function isTurkish(t) {
    var s = (String(t.lang || '') + ' ' + String(t.label || '')).toLowerCase();
    return /(^|[^a-z])(tr|tur)([^a-z]|$)|turk|türk/.test(s);
  }
  function trackLabel(t, i, kind) {
    var n = langName(t.lang), l = t.label && t.label !== t.lang ? String(t.label) : '';
    if (!n) return l || kind + ' ' + (i + 1);
    return l && l.toLowerCase().indexOf(n.toLowerCase()) < 0 ? n + ' (' + l + ')' : n;
  }

  function audioTracks() {
    var out = [];
    if (hls && hls.audioTracks && hls.audioTracks.length) {
      hls.audioTracks.forEach(function (t, i) {
        out.push({ lang: t.lang, label: t.name, active: hls.audioTrack === i, select: function () { hls.audioTrack = i; } });
      });
    } else if (video.audioTracks && video.audioTracks.length) {
      var at = video.audioTracks;
      for (var i = 0; i < at.length; i++) (function (i) {
        out.push({ lang: at[i].language, label: at[i].label, active: at[i].enabled, select: function () {
          for (var j = 0; j < at.length; j++) at[j].enabled = j === i;
        } });
      })(i);
    }
    return out;
  }

  function textTracksList() {
    var out = [];
    if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
      hls.subtitleTracks.forEach(function (t, i) {
        out.push({ lang: t.lang, label: t.name, active: hls.subtitleTrack === i, select: function () { hls.subtitleDisplay = true; hls.subtitleTrack = i; } });
      });
      return out;
    }
    var tt = video.textTracks || [];
    for (var i = 0; i < tt.length; i++) (function (t) {
      if (t.kind !== 'subtitles' && t.kind !== 'captions') return;
      out.push({ lang: t.language, label: t.label, active: t.mode === 'showing', select: function () { disableTextTracks(); t.mode = 'showing'; } });
    })(tt[i]);
    return out;
  }

  function disableTextTracks() {
    if (hls && hls.subtitleTracks && hls.subtitleTracks.length) hls.subtitleTrack = -1;
    var tt = video.textTracks || [];
    for (var i = 0; i < tt.length; i++) if (tt[i].kind === 'subtitles' || tt[i].kind === 'captions') tt[i].mode = 'disabled';
  }

  // Ayarlardaki tercihe göre Türkçe ses ve dosyadaki Türkçe altyazıyı seç
  function applyTrackPrefs() {
    if (!S.play) return;
    if (S.pref.audio === 'tr' && !P.audioApplied) {
      var at = audioTracks();
      if (at.some(function (t) { return t.active && isTurkish(t); })) P.audioApplied = true;
      else for (var i = 0; i < at.length; i++) {
        if (isTurkish(at[i])) { at[i].select(); P.audioApplied = true; toast('Türkçe ses seçildi'); break; }
      }
    }
    if (S.pref.subs === 'off' || P.subsApplied || S.sub) return;
    var tt = textTracksList();
    for (var j = 0; j < tt.length; j++) {
      if (isTurkish(tt[j])) { P.subsApplied = true; if (!tt[j].active) tt[j].select(); return; }
    }
  }

  function openAudioMenu() {
    var tr = audioTracks();
    if (tr.length < 2) {
      openMenu('Ses', [{ label: tr.length ? trackLabel(tr[0], 0, 'Ses') : 'Varsayılan ses', active: true, act: closeLayer }],
        'Bu yayında seçilebilecek başka ses yok ya da TV, dosyadaki ses kanallarını uygulamaya bildirmiyor. ' +
        'Türkçe dublajlı sürümler çoğu sağlayıcıda ayrı bir film olarak, adında "TR" ya da "Dublaj" geçen kategorilerde bulunur.');
      return;
    }
    openMenu('Ses', tr.map(function (t, i) {
      return {
        label: trackLabel(t, i, 'Ses'), sub: isTurkish(t) ? 'Türkçe dublaj' : '', active: t.active,
        act: function () { t.select(); P.audioApplied = true; toast('Ses: ' + trackLabel(t, i, 'Ses')); closeAll(); }
      };
    }));
  }

  var SIZES = ['s', 'm', 'l'], SIZE_LABEL = { s: 'Küçük', m: 'Orta', l: 'Büyük' };

  function openSubsMenu() {
    var vodish = S.play.type !== 'live';
    var tracks = textTracksList();
    var items = [{
      label: 'Kapalı', active: !S.sub && !tracks.some(function (t) { return t.active; }),
      act: function () { clearSub(); disableTextTracks(); P.subsApplied = P.autoTried = true; toast('Altyazı kapatıldı'); closeAll(); }
    }];
    tracks.forEach(function (t, i) {
      items.push({
        label: trackLabel(t, i, 'Altyazı'), sub: 'Dosyanın içindeki altyazı', active: t.active && !S.sub,
        act: function () { clearSub(); t.select(); P.subsApplied = P.autoTried = true; toast('Altyazı: ' + trackLabel(t, i, 'Altyazı')); closeAll(); }
      });
    });
    var saved = vodish && subCacheGet(posKey());
    if (S.sub) items.push({ label: S.sub.name, sub: 'İndirilen altyazı', active: true, act: closeAll });
    else if (saved) items.push({ label: saved.n, sub: 'Daha önce indirildi', act: function () { P.autoTried = true; useSub(saved.t, saved.n); closeAll(); } });
    if (vodish) {
      items.push({
        label: 'Türkçe altyazı ara ve indir',
        sub: S.os.key ? 'OpenSubtitles' : 'Önce Ayarlar’a OpenSubtitles API anahtarını yaz',
        act: function () { searchSubsMenu('tr'); }
      });
    }
    if (S.sub) {
      items.push({
        label: function () { return 'Zamanlama: ' + (S.sub.offset > 0 ? '+' : '') + S.sub.offset.toFixed(1).replace('.', ',') + ' sn'; },
        sub: 'Altyazı erken geliyorsa sağa, geç geliyorsa sola bas',
        adjust: function (d) { S.sub.offset = Math.round((S.sub.offset + d * 0.5) * 10) / 10; S.sub.lastHtml = null; tickSub(); }
      });
    }
    items.push({
      label: function () { return 'Yazı boyutu: ' + SIZE_LABEL[S.pref.size]; },
      sub: 'Sol / sağ ile değiştir',
      adjust: function (d) { var i = SIZES.indexOf(S.pref.size) + d; S.pref.size = SIZES[Math.max(0, Math.min(2, i))]; savePref(); applySubSize(); }
    });
    openMenu('Altyazı', items, vodish ? '' : 'Canlı yayınlarda yalnızca yayının içindeki altyazılar kullanılabilir.');
  }

  /* ---------------- İndirilen altyazı (SRT / VTT) ---------------- */
  var subTimer = null;

  function subTime(s) {
    var m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/);
    if (!m) return NaN;
    return (+m[1] || 0) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +((m[4] + '00').slice(0, 3)) / 1000 : 0);
  }
  function cueHtml(lines) {
    var t = lines.join('\n').replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?[ibu]>)[^>]*>/gi, '');
    t = esc(t).replace(/&lt;(\/?[ibu])&gt;/gi, '<$1>');
    return t.replace(/\n/g, '<br>');
  }
  function parseSubs(text) {
    var blocks = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/), cues = [];
    blocks.forEach(function (b) {
      var lines = b.split('\n'), k = -1;
      for (var i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) { k = i; break; }
      if (k < 0) return;
      var p = lines[k].split('-->'), s = subTime(p[0]), e = subTime(p[1]);
      var body = lines.slice(k + 1).filter(function (l) { return l.trim() !== ''; });
      if (isNaN(s) || isNaN(e) || !body.length) return;
      cues.push({ s: s, e: e, h: cueHtml(body) });
    });
    return cues.sort(function (a, b) { return a.s - b.s; });
  }

  function useSub(text, name) {
    disableTextTracks();
    S.sub = { name: name, cues: parseSubs(text), offset: 0, lastHtml: null };
    applySubSize();
    $('#subs').classList.remove('hidden');
    clearInterval(subTimer);
    subTimer = setInterval(tickSub, 150);
    tickSub();
  }
  function clearSub() {
    clearInterval(subTimer); subTimer = null;
    S.sub = null;
    $('#subs').innerHTML = '';
    $('#subs').classList.add('hidden');
  }
  function tickSub() {
    var s = S.sub;
    if (!s) return;
    var t = video.currentTime - s.offset, c = s.cues, lo = 0, hi = c.length - 1, idx = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (c[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    var html = '';
    for (var i = idx; i >= 0 && i > idx - 4; i--) if (c[i].e > t) html = c[i].h + (html ? '<br>' + html : '');
    if (html !== s.lastHtml) { s.lastHtml = html; $('#subs').innerHTML = html ? '<span>' + html + '</span>' : ''; }
  }
  function applySubSize() { $('#subs').setAttribute('data-size', S.pref.size); }

  // İndirilen altyazılar TV'de saklanır; aynı içerik tekrar açılınca indirme hakkı harcanmaz
  function subCacheGet(k) { var c = store.get('subs', {}); return c[k] || null; }
  function subCacheSet(k, t, n) {
    var c = store.get('subs', {});
    c[k] = { t: t, n: n, at: Date.now() };
    Object.keys(c).sort(function (a, b) { return c[b].at - c[a].at; }).slice(12).forEach(function (x) { delete c[x]; });
    store.set('subs', c);
  }

  /* ---------------- OpenSubtitles ---------------- */
  var OS_API = window.XTV_OS || 'https://api.opensubtitles.com/api/v1';

  function osReq(method, url, body, auth) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, url, true);
      x.timeout = 30000;
      x.setRequestHeader('Api-Key', S.os.key);
      x.setRequestHeader('X-User-Agent', 'XtreamTV v1.1.0');
      x.setRequestHeader('Accept', 'application/json');
      if (body) x.setRequestHeader('Content-Type', 'application/json');
      if (auth && S.os.token) x.setRequestHeader('Authorization', 'Bearer ' + S.os.token);
      x.onload = function () {
        var d = null;
        try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) { resolve(d || {}); return; }
        var msg = (d && (d.message || (d.errors && d.errors.join(' ')))) || '';
        var err = new Error(osError(x.status, msg));
        err.status = x.status;
        reject(err);
      };
      x.onerror = function () { reject(new Error('OpenSubtitles’a ulaşılamadı. İnternet bağlantısını kontrol et.')); };
      x.ontimeout = function () { reject(new Error('OpenSubtitles yanıt vermedi.')); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }

  function osError(status, msg) {
    var tail = msg ? ' (' + msg + ')' : '';
    if (status === 401 || status === 403) return 'OpenSubtitles anahtarı ya da hesap bilgileri kabul edilmedi.' + tail;
    if (status === 406 || (/download/i.test(msg) && /limit|allowed|quota/i.test(msg))) return 'Bugünkü altyazı indirme hakkın doldu.' + tail;
    if (status === 429) return 'Çok sık istek gönderildi, biraz bekleyip tekrar dene.';
    return 'OpenSubtitles hata döndürdü (' + status + ')' + (msg ? ': ' + msg : '.');
  }

  function osParams(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null && o[k] !== 0; }).sort()
      .map(function (k) { return k + '=' + enc(String(o[k]).toLowerCase()); }).join('&');
  }

  function osLogin() {
    return osReq('POST', OS_API + '/login', { username: S.os.user, password: S.os.pass }).then(function (d) {
      S.os.token = d.token || '';
      S.os.base = d.base_url || '';
      saveOs();
      return d;
    });
  }

  function osDownloadBase() {
    if (!S.os.base || window.XTV_OS) return OS_API;
    return 'https://' + S.os.base.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\/api\/v1$/, '') + '/api/v1';
  }

  function fetchText(url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest(), useBuf = typeof TextDecoder !== 'undefined';
      x.open('GET', url, true);
      x.timeout = 30000;
      if (useBuf) x.responseType = 'arraybuffer';
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) { reject(new Error('Altyazı dosyası indirilemedi (' + x.status + ').')); return; }
        if (!useBuf) { resolve(x.responseText); return; }
        var buf = new Uint8Array(x.response);
        // Türkçe altyazılar bazen eski Windows-1254 kodlamasıyla gelir
        try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(buf)); }
        catch (e) {
          try { resolve(new TextDecoder('windows-1254').decode(buf)); }
          catch (e2) { resolve(new TextDecoder('utf-8').decode(buf)); }
        }
      };
      x.onerror = function () { reject(new Error('Altyazı dosyası indirilemedi.')); };
      x.ontimeout = x.onerror;
      x.send();
    });
  }

  function osDownload(fileId) {
    var ready = S.os.user && S.os.pass && !S.os.token ? osLogin() : Promise.resolve();
    function go() { return osReq('POST', osDownloadBase() + '/download', { file_id: fileId, sub_format: 'srt' }, true); }
    return ready.then(go).catch(function (e) {
      if (e.status === 401 && S.os.user && S.os.pass) { S.os.token = ''; return osLogin().then(go); }
      throw e;
    }).then(function (d) {
      if (!d.link) throw new Error(osError(406, d.message || ''));
      return fetchText(d.link).then(function (txt) { return { text: txt, name: d.file_name || 'Altyazı', remaining: d.remaining }; });
    });
  }

  function numId(v) { var n = parseInt(v, 10); return n > 0 ? n : 0; }
  function imdbNum(v) { var m = String(v || '').match(/(?:tt)?0*(\d{3,})/); return m ? +m[1] : 0; }
  function extend(a, b) { for (var k in b) a[k] = b[k]; return a; }

  // Sağlayıcıdan TMDB / IMDb kimliği ve orijinal adı al; altyazı bunlarla daha doğru bulunur
  function subMeta() {
    var p = S.play, it = p.list[p.idx];
    if (p.type === 'vod') {
      return cached('vodinfo|' + it.stream_id, function () { return api('get_vod_info', { vod_id: it.stream_id }); })
        .catch(function () { return {}; })
        .then(function (d) {
          var info = (d && d.info) || {}, md = (d && d.movie_data) || {};
          return {
            type: 'movie', tmdb: numId(info.tmdb_id || info.tmdb), imdb: imdbNum(info.imdb_id || info.imdb_url),
            query: cleanTitle(info.o_name || info.original_name || md.name || it.name), year: yearOf(it, info)
          };
        });
    }
    var ctx = p.ctx || {}, info = ctx.info || {};
    return Promise.resolve({
      type: 'episode', tmdb: numId(info.tmdb_id || info.tmdb), imdb: imdbNum(info.imdb_id),
      query: cleanTitle(info.o_name || info.original_name || ctx.name || ''),
      season: +(it._season != null ? it._season : it.season) || 0, episode: +it.episode_num || 0
    });
  }

  function osSearch(meta, lang) {
    var base = { languages: lang, type: meta.type }, tries = [];
    if (meta.type === 'movie') {
      if (meta.tmdb) tries.push({ tmdb_id: meta.tmdb });
      if (meta.imdb) tries.push({ imdb_id: meta.imdb });
      if (meta.query) tries.push({ query: meta.query, year: meta.year });
      if (meta.query && meta.year) tries.push({ query: meta.query });
    } else {
      var se = { season_number: meta.season, episode_number: meta.episode };
      if (meta.tmdb) tries.push(extend({ parent_tmdb_id: meta.tmdb }, se));
      if (meta.imdb) tries.push(extend({ parent_imdb_id: meta.imdb }, se));
      if (meta.query) tries.push(extend({ query: meta.query }, se));
    }
    if (!tries.length) return Promise.reject(new Error('İçeriğin adı bulunamadı, altyazı aranamıyor.'));
    var i = 0;
    function next() {
      if (i >= tries.length) return Promise.resolve([]);
      var q = extend(extend({}, base), tries[i++]);
      return osReq('GET', OS_API + '/subtitles?' + osParams(q)).then(function (d) {
        var list = (d && d.data) || [];
        return list.length ? list : next();
      });
    }
    return next().then(function (list) {
      return list.map(function (x) {
        var a = x.attributes || {}, f = (a.files || [])[0];
        if (!f) return null;
        return {
          id: f.file_id, name: a.release || f.file_name || 'Altyazı', lang: a.language, dl: +a.download_count || 0,
          mt: a.machine_translated || a.ai_translated ? 1 : 0, hi: !!a.hearing_impaired, trusted: a.from_trusted ? 1 : 0
        };
      }).filter(Boolean).sort(function (a, b) {
        return (a.mt - b.mt) || (b.trusted - a.trusted) || (b.dl - a.dl);
      }).slice(0, 20);
    });
  }

  function fmtCount(n) { return n >= 1000 ? (Math.round(n / 100) / 10).toString().replace('.', ',') + ' bin' : String(n); }

  function searchSubsMenu(lang) {
    if (!S.os.key) { toast('Önce Ayarlar > Altyazı indirme bölümüne OpenSubtitles API anahtarını yaz.'); return; }
    var key = posKey(), langLabel = lang === 'tr' ? 'Türkçe' : 'İngilizce';
    openMenu(langLabel + ' altyazı', [{ label: 'Aranıyor…', act: noop }]);
    subMeta().then(function (m) { return osSearch(m, lang); }).then(function (res) {
      if (!S.play || posKey() !== key || P.layer !== 'menu') return;
      var items = res.map(function (r) {
        var sub = langName(r.lang) + ', ' + fmtCount(r.dl) + ' indirme' + (r.mt ? ', makine çevirisi' : '') + (r.hi ? ', işitme engelliler için' : '');
        return { label: r.name, sub: sub, act: function () { downloadSub(r.id, r.name, false); } };
      });
      if (!items.length) {
        items.push({ label: langLabel + ' altyazı bulunamadı', act: closeLayer });
        if (lang === 'tr') items.push({ label: 'İngilizce altyazı ara', act: function () { searchSubsMenu('en'); } });
      }
      openMenu(langLabel + ' altyazılar', items, items.length && res.length
        ? 'Sürüm adı izlediğin dosyaya ne kadar yakınsa zamanlama o kadar iyi tutar. Kayarsa Altyazı menüsündeki Zamanlama ayarıyla düzeltebilirsin.' : '');
    }).catch(function (e) {
      if (P.layer === 'menu') openMenu('Altyazı', [{ label: 'Tamam', act: closeLayer }], e.message);
    });
  }

  function downloadSub(fileId, label, silent) {
    var key = posKey();
    if (!silent) openMenu('Altyazı', [{ label: 'İndiriliyor…', act: noop }]);
    return osDownload(fileId).then(function (r) {
      if (!S.play || posKey() !== key) return;
      if (!parseSubs(r.text).length) throw new Error('İndirilen dosyada okunabilir altyazı yok. Listeden başka bir altyazı seç.');
      subCacheSet(key, r.text, label || r.name);
      useSub(r.text, label || r.name);
      P.autoTried = true;
      toast('Altyazı yüklendi' + (r.remaining != null ? '. Bugün kalan indirme hakkı: ' + r.remaining : ''));
      if (!silent && P.layer === 'menu') closeAll();
    }).catch(function (e) {
      if (silent || P.layer !== 'menu') { toast(e.message); return; }
      openMenu('Altyazı', [{ label: 'Tamam', act: closeLayer }], e.message);
    });
  }

  // Film/bölüm başlayınca: kayıtlı altyazıyı aç, yoksa ayara göre Türkçe altyazıyı kendiliğinden indir
  function autoSubs() {
    if (!S.play || S.play.type === 'live' || P.autoTried || S.pref.subs === 'off' || S.sub) return;
    P.autoTried = true;
    var saved = subCacheGet(posKey());
    if (saved) { useSub(saved.t, saved.n); return; }
    if (P.subsApplied || S.pref.subs !== 'auto' || !S.os.key) return;
    var key = posKey();
    subMeta().then(function (m) { return osSearch(m, 'tr'); }).then(function (res) {
      if (!S.play || posKey() !== key || S.sub || P.subsApplied) return;
      if (!res.length) { toast('Bu içerik için Türkçe altyazı bulunamadı.'); return; }
      toast('Türkçe altyazı indiriliyor…');
      return downloadSub(res[0].id, res[0].name, true);
    }).catch(function (e) { toast(e.message); });
  }

  /* ---------------- Oynatırken listeler paneli ---------------- */
  var G = { sec: 'live', catId: '*', lastCat: {}, list: [], rendered: 0, series: null, epgTimer: null };
  var GBATCH = 100, epgCache = {};

  function openGuide() {
    var t = S.play.type;
    P.layer = 'guide';
    $('#pmenu').classList.add('hidden');
    $('#guide').classList.remove('hidden');
    $('#player').classList.add('guide-open');
    showOsd();
    $('#g-tabs .gtab[data-sec="yt"]').classList.toggle('hidden', !M.on);
    var at = M.on && M.tiles[M.active];
    guideSection(at && at.kind === 'yt' ? 'yt' : t === 'live' ? 'live' : t === 'vod' ? 'vod' : 'series', 'playing');
  }

  function guideSection(sec, focusMode) {
    G.sec = sec; G.series = null;
    var tabs = document.querySelectorAll('#g-tabs .gtab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-sec') === sec);
    $('#g-cats').innerHTML = '<p class="empty">Yükleniyor…</p>';
    $('#g-items').innerHTML = '';
    $('#g-info').textContent = '';
    if (sec === 'yt') { ytCats(focusMode); return; }
    cached('cats|' + sec, function () { return api(CAT_ACTION[sec]); }).then(function (cats) {
      if (G.sec !== sec || P.layer !== 'guide') return;
      var list = [{ category_id: 'fav', category_name: 'Favoriler' }, { category_id: '*', category_name: 'Tümü' }].concat(Array.isArray(cats) ? cats : []);
      $('#g-cats').innerHTML = list.map(function (c) {
        return '<button class="f gcat" data-cat="' + esc(c.category_id) + '">' + esc(c.category_name) + '</button>';
      }).join('');
      guideCat(G.lastCat[sec] || S.lastCat[sec] || '*', focusMode);
    }).catch(function (e) { $('#g-cats').innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
  }

  function playingIndex(arr, sec) {
    if (!S.play || (sec === 'live') !== (S.play.type === 'live') || (sec === 'vod') !== (S.play.type === 'vod') || sec === 'series') return -1;
    var cur = String(idOf(sec, S.play.list[S.play.idx]));
    for (var i = 0; i < arr.length; i++) if (String(idOf(sec, arr[i])) === cur) return i;
    return -1;
  }

  // focusMode: 'playing' (izlenene odaklan), 'items' (ilk öğe), sayı (o sıradaki öğe) ya da boş (odak kategoride kalır)
  function guideCat(catId, focusMode) {
    var sec = G.sec;
    G.catId = catId; G.lastCat[sec] = catId; G.series = null;
    var btns = document.querySelectorAll('#g-cats .gcat'), activeBtn = null;
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-cat') === String(catId);
      btns[i].classList.toggle('active', on);
      if (on) { activeBtn = btns[i]; S.zoneFocus.gcats = btns[i]; }
    }
    S.zoneFocus.gitems = null;
    $('#g-items').innerHTML = '<p class="empty">Yükleniyor…</p>';
    loadList(sec, catId).then(function (arr) {
      if (G.sec !== sec || G.catId !== catId || P.layer !== 'guide' || G.series) return;
      arr = Array.isArray(arr) ? arr : [];
      if (catId === 'fav') arr = arr.filter(function (it) { return S.favs[sec].indexOf(String(idOf(sec, it))) >= 0; });
      G.list = arr; G.rendered = 0;
      $('#g-items').innerHTML = '';
      if (!arr.length) {
        $('#g-items').innerHTML = '<p class="empty">' + (catId === 'fav' ? 'Bu bölümde favori yok. Bir öğenin üzerindeyken kırmızı tuşa bas.' : 'Bu kategoride içerik yok.') + '</p>';
        if (focusMode != null) focusEl(activeBtn);
        return;
      }
      var target = typeof focusMode === 'number' ? focusMode : focusMode === 'playing' ? Math.max(playingIndex(arr, sec), 0) : 0;
      target = Math.min(target, arr.length - 1);
      guideRender(target);
      if (focusMode != null) focusEl($('#g-items .grow[data-i="' + target + '"]'));
    }).catch(function (e) { $('#g-items').innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
  }

  function guideRow(sec, it, i) {
    var playing = playingIndex([it], sec) === 0;
    var meta = '';
    if (sec !== 'live') { var r = ratingOf(sec, it); if (r.v) meta = (r.imdb ? 'IMDb ' : '★ ') + r.v.toFixed(1); }
    return '<button class="f grow' + (playing ? ' playing' : '') + (isFav(sec, it) ? ' fav' : '') + '" data-i="' + i + '">' +
      (sec === 'live' ? '<span class="num">' + esc(it.num || i + 1) + '</span>' : '') +
      '<span class="name">' + esc(it.name) + '</span>' + (meta ? '<span class="meta">' + meta + '</span>' : '') + '</button>';
  }

  function guideRender(until) {
    var end = Math.min(G.list.length, Math.max(G.rendered + GBATCH, (until || 0) + 20)), html = '';
    for (var i = G.rendered; i < end; i++) html += guideRow(G.sec, G.list[i], i);
    $('#g-items').insertAdjacentHTML('beforeend', html);
    G.rendered = end;
  }

  function flattenEpisodes(d) {
    var eps = (d && d.episodes) || {}, out = [];
    Object.keys(eps).sort(function (a, b) { return a - b; }).forEach(function (s) {
      (eps[s] || []).forEach(function (ep) {
        if (ep._season == null) ep._season = ep.season != null && ep.season !== '' ? ep.season : s;
        out.push(ep);
      });
    });
    return out;
  }

  function guideOpenSeries(series, idx) {
    $('#g-items').innerHTML = '<p class="empty">Bölümler yükleniyor…</p>';
    $('#g-info').textContent = '';
    api('get_series_info', { series_id: series.series_id }).then(function (d) {
      if (P.layer !== 'guide' || G.sec !== 'series') return;
      var eps = flattenEpisodes(d);
      G.series = { name: series.name, info: (d && d.info) || {}, eps: eps, idx: idx };
      $('#g-items').innerHTML = '<button class="f grow back" data-back="1"><span class="name">‹ ' + esc(series.name) + '</span></button>' +
        (eps.length ? eps.map(function (ep, i) {
          return '<button class="f grow" data-i="' + i + '"><span class="name">' + esc(epLabel(ep) + '   ' + (ep.title || '')) + '</span></button>';
        }).join('') : '<p class="empty">Bu dizide bölüm bulunamadı.</p>');
      focusEl($('#g-items .grow[data-i="0"]') || $('#g-items .grow'));
    }).catch(function (e) { $('#g-items').innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
  }

  $('#g-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.gtab');
    if (b) guideSection(b.getAttribute('data-sec'));
  });
  $('#g-cats').addEventListener('click', function (e) {
    var b = e.target.closest('.gcat');
    if (!b) return;
    if (G.sec === 'yt') ytCat(b.getAttribute('data-cat')); else guideCat(b.getAttribute('data-cat'));
  });
  $('#g-items').addEventListener('click', function (e) {
    var b = e.target.closest('.grow');
    if (!b) return;
    if (G.sec === 'yt') { ytOpen(G.list[+b.getAttribute('data-i')]); return; }
    if (b.getAttribute('data-back')) { guideCat(G.catId, G.series ? G.series.idx : 0); return; }
    var i = +b.getAttribute('data-i');
    if (G.series) {
      var ctx = { name: G.series.name, info: G.series.info }, eps = G.series.eps;
      closeAll(); switchPlayback(eps, i, 'episode', ctx);
      return;
    }
    if (G.sec === 'series') {
      if (M.on) { toast('Çoklu ekranda yalnızca canlı kanallar açılabilir. Önce Geri ile tek ekrana dön.'); return; }
      guideOpenSeries(G.list[i], i); return;
    }
    var list = G.list, type = G.sec === 'live' ? 'live' : 'vod';
    if (M.on) {
      if (type !== 'live') { toast('Çoklu ekranda yalnızca canlı kanallar açılabilir. Önce Geri ile tek ekrana dön.'); return; }
      closeAll(); tilePlay(M.tiles[M.active], list, i);
      return;
    }
    closeAll(); switchPlayback(list, i, type);
  });
  $('#g-items').addEventListener('scroll', function () {
    if (G.series || G.rendered >= G.list.length) return;
    if (this.scrollTop + this.clientHeight > this.scrollHeight - 600) guideRender();
  });
  $('#g-items').addEventListener('focusin', function (e) {
    if (G.sec === 'yt') return;
    var b = e.target.closest && e.target.closest('.grow');
    if (!b || G.series || b.getAttribute('data-back')) { $('#g-info').textContent = ''; return; }
    var i = +b.getAttribute('data-i');
    if (i > G.rendered - 15 && G.rendered < G.list.length) guideRender();
    guideInfo(G.list[i]);
  });

  // Kanal listesinde odaklanılan kanalın şu anki programı
  function guideInfo(it) {
    clearTimeout(G.epgTimer);
    $('#g-info').textContent = '';
    if (!it || G.sec !== 'live') return;
    var c = epgCache[it.stream_id];
    if (c && Date.now() - c.at < 300000) { $('#g-info').textContent = c.txt; return; }
    G.epgTimer = setTimeout(function () {
      api('get_short_epg', { stream_id: it.stream_id, limit: 1 }).then(function (d) {
        var e = ((d && d.epg_listings) || [])[0];
        var txt = e ? 'Şimdi: ' + (e.start_timestamp ? hhmm(+e.start_timestamp) + '  ' : '') + b64(e.title) : 'Program bilgisi yok';
        epgCache[it.stream_id] = { at: Date.now(), txt: txt };
        var f = document.activeElement;
        if (f && f.closest && f.closest('#g-items') && G.list[+f.getAttribute('data-i')] === it) $('#g-info').textContent = txt;
      }).catch(noop);
    }, 400);
  }

  $('#g-items').addEventListener('keydown', function (e) {
    if (e.target.id === 'yt-q' && e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); ytRunSearch(); }
  });

  function guideToggleFav() {
    var el = document.activeElement;
    if (G.sec === 'yt') {
      if (!el || !el.classList.contains('grow')) return;
      var yit = G.list[+el.getAttribute('data-i')];
      if (!yit) return;
      el.classList.toggle('fav', ytToggleMine(yit));
      if (G.catId === 'mine') ytCat('mine', 'items');
      return;
    }
    if (!el || !el.classList.contains('grow') || G.series || el.getAttribute('data-back')) return;
    var sec = G.sec, it = G.list[+el.getAttribute('data-i')];
    if (!it) return;
    var id = String(idOf(sec, it)), arr = S.favs[sec], k = arr.indexOf(id);
    if (k >= 0) { arr.splice(k, 1); toast(it.name + ' favorilerden çıkarıldı'); }
    else { arr.push(id); toast(it.name + ' favorilere eklendi'); }
    el.classList.toggle('fav', k < 0);
    store.set('favs', S.favs);
  }

  /* ---------------- Çoklu ekran (aynı anda 2 ya da 4 kanal) ----------------
   * Her ekran ayrı bir bağlantı açar. Sağlayıcının izin verdiği bağlantı sayısı
   * ve TV'nin aynı anda çözebildiği video sayısı sınırı belirler. */
  var M = { on: false, n: 0, tiles: [], active: 0 };

  function maxConnections() { var u = (S.info && S.info.user_info) || {}; return +u.max_connections || 0; }

  function openMultiMenu() {
    var mc = maxConnections();
    var note = 'Her ekran ayrı bir yayın bağlantısı kullanır. ' +
      (mc ? 'Hesabın aynı anda ' + mc + ' bağlantıya izin veriyor' + (mc < 2 ? '; ikinci ekran büyük ihtimalle açılmaz, sağlayıcından bağlantı sayısını artırmasını istemen gerekir.' : '.') : '') +
      ' TV de aynı anda çözebileceği video sayısıyla sınırlıdır.';
    openMenu('Çoklu ekran', [
      { label: '2 ekran', sub: 'Yan yana', act: function () { closeAll(); startMulti(2); } },
      { label: '4 ekran', sub: '2 × 2', act: function () { closeAll(); startMulti(4); } }
    ], note + ' YouTube yayınları sağlayıcı bağlantısı kullanmaz: ekranlardan birinde OK ile panel açılınca YouTube sekmesinden seçebilirsin.');
  }

  function tileHtml(i) {
    return '<div class="tile" data-i="' + i + '"><video playsinline></video>' +
      '<div class="tile-empty">Kanal seçmek için OK</div><div class="tile-label"></div></div>';
  }

  function startMulti(n) {
    if (!S.play || S.play.type !== 'live') { toast('Çoklu ekran yalnızca canlı yayında kullanılabilir.'); return; }
    var first = { list: S.play.list, idx: S.play.idx };
    stopVideo(); clearSub();
    M.on = true; M.n = n; M.active = 0; M.tiles = [];
    var box = $('#multi');
    box.className = 'n' + n;
    var html = '';
    for (var i = 0; i < n; i++) html += tileHtml(i);
    box.innerHTML = html + '<div class="multi-hint">Yön tuşları: ekran seç     OK: kanal seç     CH + / −: kanal değiştir     Geri: tek ekran</div>';
    var els = box.querySelectorAll('.tile');
    for (var j = 0; j < n; j++) M.tiles.push({ el: els[j], video: els[j].querySelector('video'), hls: null, list: null, idx: -1, kind: 'iptv' });
    $('#player').classList.add('multi');
    tilePlay(M.tiles[0], first.list, first.idx);
    setActiveTile(n > 1 ? 1 : 0);
    var mc = maxConnections();
    if (mc && mc < n) toast('Hesabın aynı anda ' + mc + ' bağlantıya izin veriyor; bazı ekranlar açılmayabilir.');
    // Boş ekran için kanal seçimini hemen aç
    if (M.tiles[M.active].idx < 0 && M.tiles[M.active].kind !== 'yt') openGuide();
  }

  function tileStop(t) {
    var fr = t.el.querySelector('iframe');
    if (fr) fr.parentNode.removeChild(fr);
    t.el.classList.remove('yt');
    t.kind = 'iptv'; t.ytId = null;
    if (t.hls) { try { t.hls.destroy(); } catch (e) {} t.hls = null; }
    try { t.video.pause(); } catch (e) {}
    t.video.removeAttribute('src');
    try { t.video.load(); } catch (e) {}
  }

  function tilePlay(t, list, idx) {
    var it = list[idx];
    if (!it) return;
    tileStop(t);
    t.list = list; t.idx = idx;
    var url = streamUrl('live', it);
    var isHls = /\.m3u8$/.test(url), nativeHls = !!t.video.canPlayType('application/vnd.apple.mpegurl');
    if (isHls && !nativeHls && window.Hls && Hls.isSupported()) {
      t.hls = new Hls({ enableWorker: true, maxBufferLength: 20 });
      t.hls.loadSource(url); t.hls.attachMedia(t.video);
    } else {
      t.video.src = url;
    }
    t.video.muted = M.tiles.indexOf(t) !== M.active;
    t.el.classList.add('has');
    t.el.classList.remove('err');
    t.el.querySelector('.tile-label').textContent = (it.num ? it.num + '  ' : '') + it.name;
    t.video.onerror = function () { t.el.classList.add('err'); t.el.querySelector('.tile-empty').textContent = 'Açılamadı. Bağlantı sınırı ya da TV sınırı olabilir.'; };
    var pr = t.video.play();
    if (pr && pr.catch) pr.catch(noop);
    if (M.tiles.indexOf(t) === M.active) syncPlayToTile();
  }

  // Panel ve kanal değiştirme etkin ekranın kanalına göre çalışsın
  function syncPlayToTile() {
    var t = M.tiles[M.active];
    S.play = t && t.idx >= 0 ? { list: t.list, idx: t.idx, type: 'live' } : { list: [{}], idx: 0, type: 'live' };
  }

  function setActiveTile(i) {
    M.active = i;
    M.tiles.forEach(function (t, j) {
      t.el.classList.toggle('active', j === i);
      t.video.muted = j !== i;
      if (t.kind === 'yt') ytSend(t, j === i ? 'unmute' : 'mute');
    });
    syncPlayToTile();
  }

  function multiMove(dir) {
    var cols = 2, i = M.active, n = M.n;
    if (dir === 'left' && i % cols > 0) i--;
    else if (dir === 'right' && i % cols < cols - 1 && i + 1 < n) i++;
    else if (dir === 'up' && i - cols >= 0) i -= cols;
    else if (dir === 'down' && i + cols < n) i += cols;
    setActiveTile(i);
  }

  function multiZap(d) {
    var t = M.tiles[M.active];
    if (!t || t.idx < 0) return;
    var n = t.list.length;
    tilePlay(t, t.list, (t.idx + d + n) % n);
  }

  // Çoklu ekrandan çık: etkin ekrandaki kanal tam ekranda devam eder
  function stopMulti(keepActive) {
    // Tek ekrana etkin IPTV kanalı, o YouTube ise ilk IPTV kanalı geçer
    var t = M.tiles[M.active], keep = null;
    if (keepActive) {
      if (!(t && t.idx >= 0)) t = M.tiles.filter(function (x) { return x.idx >= 0; })[0];
      if (t) keep = { list: t.list, idx: t.idx };
    }
    M.tiles.forEach(tileStop);
    M.on = false; M.tiles = []; M.n = 0;
    $('#multi').innerHTML = '';
    $('#player').classList.remove('multi');
    if (keep) { S.play = { list: keep.list, idx: keep.idx, type: 'live' }; loadCurrent(); }
    else if (keepActive) closePlayer();
  }

  $('#multi').addEventListener('click', function (e) {
    var t = e.target.closest('.tile');
    if (!t || !M.on) return;
    var i = +t.getAttribute('data-i');
    if (i === M.active) openGuide(); else setActiveTile(i);
  });

  function multiKey(e, k) {
    var dir = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[k];
    e.preventDefault();
    if (isBackKey(k, false)) { stopMulti(true); return; }
    if (dir) { multiMove(dir); return; }
    if (k === KEY.ENTER) { openGuide(); return; }
    if (k === KEY.CH_UP || k === KEY.PG_UP) { multiZap(-1); return; }
    if (k === KEY.CH_DOWN || k === KEY.PG_DOWN) { multiZap(1); return; }
    if (k === KEY.STOP) { stopMulti(false); closePlayer(); }
  }

  /* ---------------- YouTube (çoklu ekranda) ----------------
   * YouTube videoları GitHub Pages'teki yt.html üzerinden açılır; YouTube oynatıcısı
   * doğrudan uygulamanın içinden açıldığında çoğu zaman "yapılandırma hatası" veriyor.
   * Arama ve canlı yayın bulma YouTube Data API v3 anahtarıyla yapılır. */
  var YT_PAGE = window.XTV_YT_PAGE || 'https://fundigundi99-max.github.io/XtreamTV/yt.html';
  var YT_API = window.XTV_YT_API || 'https://www.googleapis.com/youtube/v3/';
  var YT_PRESETS = {
    tr: [
      { handle: '@haberturktv', title: 'Habertürk' }, { handle: '@NTV', title: 'NTV' },
      { handle: '@cnnturk', title: 'CNN Türk' }, { handle: '@trthaber', title: 'TRT Haber' },
      { handle: '@sozcutelevizyonu', title: 'Sözcü TV' }
    ],
    de: [
      { handle: '@tagesschau', title: 'tagesschau' }, { handle: '@WELTVideoTV', title: 'WELT' },
      { handle: '@DWDeutsch', title: 'DW Deutsch' }, { handle: '@ZDFheute', title: 'ZDFheute' }
    ]
  };
  var YT_CATS = [
    { id: 'search', name: 'Ara' }, { id: 'mine', name: 'Listem' },
    { id: 'tr', name: 'Türk haber kanalları' }, { id: 'de', name: 'Alman haber kanalları' }
  ];
  var ytLiveCache = {}, ytLastSearch = { q: '', items: [] };

  function htmlDecode(s) { var t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; }

  function ytGet(path, params) {
    if (!S.yt.key) return Promise.reject(new Error('Önce Ayarlar > YouTube bölümüne YouTube API anahtarını yaz.'));
    var u = YT_API + path + '?key=' + enc(S.yt.key);
    for (var k in params) if (params[k] !== '' && params[k] != null) u += '&' + k + '=' + enc(params[k]);
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', u, true);
      x.timeout = 20000;
      x.onload = function () {
        var d = null;
        try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300 && d) { resolve(d); return; }
        var reason = d && d.error && d.error.errors && d.error.errors[0] && d.error.errors[0].reason;
        if (/quota/i.test(reason || '')) reject(new Error('YouTube API günlük kotası doldu. Yarın sıfırlanır.'));
        else if (x.status === 400 || x.status === 403) reject(new Error('YouTube API anahtarı kabul edilmedi. Anahtarı ve "YouTube Data API v3"ün açık olduğunu kontrol et.'));
        else reject(new Error('YouTube hata döndürdü (' + x.status + ').'));
      };
      x.onerror = function () { reject(new Error('YouTube’a ulaşılamadı.')); };
      x.ontimeout = x.onerror;
      x.send();
    });
  }

  function ytSearch(q) {
    return ytGet('search', { part: 'snippet', type: 'video', maxResults: 25, q: q }).then(function (d) {
      return (d.items || []).filter(function (x) { return x.id && x.id.videoId; }).map(function (x) {
        var sn = x.snippet || {};
        return { type: 'video', id: x.id.videoId, title: htmlDecode(sn.title), sub: htmlDecode(sn.channelTitle), live: sn.liveBroadcastContent === 'live' };
      });
    });
  }

  // Kanal adresinden (@handle) şu anki canlı yayını bul
  function ytChannelId(handle) {
    var map = store.get('ytch', {});
    if (map[handle]) return Promise.resolve(map[handle]);
    return ytGet('channels', { part: 'id', forHandle: handle }).then(function (d) {
      var id = d.items && d.items[0] && d.items[0].id;
      if (!id) throw new Error(handle + ' adlı kanal bulunamadı.');
      map[handle] = id; store.set('ytch', map);
      return id;
    });
  }
  function ytLiveVideo(item) {
    var c = ytLiveCache[item.handle];
    if (c && Date.now() - c.at < 600000) return Promise.resolve(c.id);
    return ytChannelId(item.handle).then(function (cid) {
      return ytGet('search', { part: 'id', channelId: cid, eventType: 'live', type: 'video', maxResults: 1 });
    }).then(function (d) {
      var v = d.items && d.items[0] && d.items[0].id && d.items[0].id.videoId;
      if (!v) throw new Error(item.title + ' şu an YouTube’da canlı yayında değil.');
      ytLiveCache[item.handle] = { id: v, at: Date.now() };
      return v;
    });
  }

  function ytInMine(it) {
    var k = it.type === 'channel' ? it.handle : it.id;
    for (var i = 0; i < S.yt.mine.length; i++) {
      var m = S.yt.mine[i];
      if ((m.type === 'channel' ? m.handle : m.id) === k) return i;
    }
    return -1;
  }

  function ytRow(it, i) {
    var meta = it.type === 'channel' ? 'canlı yayın' : it.live ? 'CANLI' : '';
    return '<button class="f grow' + (ytInMine(it) >= 0 ? ' fav' : '') + '" data-i="' + i + '"><span class="name">' + esc(it.title) +
      (it.sub ? '<small class="yt-sub">  ' + esc(it.sub) + '</small>' : '') + '</span>' + (meta ? '<span class="meta">' + meta + '</span>' : '') + '</button>';
  }

  function ytShow(items, focusMode, emptyMsg) {
    G.list = items; G.rendered = items.length;
    var head = G.catId === 'search'
      ? '<input id="yt-q" class="f" type="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="YouTube’da ara, sonra OK" value="' + esc(ytLastSearch.q) + '">'
      : '';
    $('#g-items').innerHTML = head + (items.length ? items.map(ytRow).join('') : '<p class="empty">' + esc(emptyMsg || '') + '</p>');
    if (focusMode === 'input' && $('#yt-q')) focusEl($('#yt-q'));
    else if (focusMode != null) focusEl($('#g-items .grow') || $('#yt-q'));
  }

  function ytCats(focusMode) {
    $('#g-cats').innerHTML = YT_CATS.map(function (c) {
      return '<button class="f gcat" data-cat="' + c.id + '">' + c.name + '</button>';
    }).join('');
    ytCat(G.lastCat.yt || 'search', focusMode);
  }

  function ytCat(id, focusMode) {
    G.catId = id; G.lastCat.yt = id; G.series = null;
    var btns = document.querySelectorAll('#g-cats .gcat');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-cat') === id;
      btns[i].classList.toggle('active', on);
      if (on) S.zoneFocus.gcats = btns[i];
    }
    S.zoneFocus.gitems = null;
    $('#g-info').textContent = S.yt.key ? '' : 'YouTube için Ayarlar’a YouTube API anahtarını yaz.';
    if (id === 'search') ytShow(ytLastSearch.items, focusMode === 'playing' ? 'input' : focusMode, ytLastSearch.q ? 'Sonuç yok.' : 'Aramak için yukarıdaki kutuya yaz ve OK’e bas.');
    else if (id === 'mine') ytShow(S.yt.mine.slice(), focusMode, 'Listen boş. Arama sonuçlarında ya da hazır kanallarda kırmızı tuşla (klavyede F) ekle.');
    else ytShow(YT_PRESETS[id].map(function (p) { return { type: 'channel', handle: p.handle, title: p.title, sub: p.handle }; }), focusMode, '');
  }

  function ytRunSearch() {
    var q = $('#yt-q') ? $('#yt-q').value.trim() : '';
    if (!q) return;
    ytLastSearch.q = q;
    $('#g-info').textContent = 'Aranıyor…';
    ytSearch(q).then(function (items) {
      ytLastSearch.items = items;
      if (P.layer === 'guide' && G.sec === 'yt' && G.catId === 'search') { ytShow(items, 'items', 'Sonuç yok.'); $('#g-info').textContent = items.length + ' sonuç'; }
    }).catch(function (e) { $('#g-info').textContent = e.message; });
  }

  function ytOpen(it) {
    var t = M.tiles[M.active];
    if (!t) return;
    if (it.type === 'video') { closeAll(); tileYoutube(t, it.id, it.title); return; }
    $('#g-info').textContent = it.title + ' canlı yayını aranıyor…';
    ytLiveVideo(it).then(function (vid) { closeAll(); tileYoutube(t, vid, it.title); })
      .catch(function (e) { $('#g-info').textContent = e.message; toast(e.message); });
  }

  function ytToggleMine(it) {
    var k = ytInMine(it);
    if (k >= 0) { S.yt.mine.splice(k, 1); toast(it.title + ' listenden çıkarıldı'); }
    else { S.yt.mine.push(it); toast(it.title + ' listene eklendi'); }
    saveYt();
    return k < 0;
  }

  function saveYt() { store.set('yt', S.yt); }

  function tileYoutube(t, videoId, title) {
    tileStop(t);
    var i = M.tiles.indexOf(t);
    t.kind = 'yt'; t.ytId = videoId; t.list = null; t.idx = -1;
    var src = YT_PAGE + '?v=' + enc(videoId) + '&mute=' + (i === M.active ? 0 : 1) + '&id=' + i;
    t.el.insertAdjacentHTML('afterbegin', '<iframe class="tile-yt" tabindex="-1" allow="autoplay; encrypted-media" src="' + esc(src) + '"></iframe>');
    t.el.classList.add('has', 'yt');
    t.el.classList.remove('err');
    t.el.querySelector('.tile-label').textContent = 'YouTube  ' + title;
    if (i === M.active) syncPlayToTile();
  }

  function ytSend(t, cmd) {
    var f = t.el.querySelector('iframe');
    if (f && f.contentWindow) { try { f.contentWindow.postMessage({ cmd: cmd }, '*'); } catch (e) {} }
  }

  // yt.html'den gelen hata mesajları
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.xtv !== 'yt' || m.type !== 'error' || !M.on) return;
    var t = M.tiles[+m.id];
    if (!t || t.kind !== 'yt') return;
    var code = +m.data;
    t.el.classList.add('err');
    t.el.querySelector('.tile-empty').textContent = code === 101 || code === 150
      ? 'Bu videonun sahibi başka uygulamalarda oynatılmasına izin vermiyor.'
      : 'YouTube videosu açılamadı (kod ' + code + ').';
  });

  // YouTube çerçevesi kumanda odağını almasın
  window.addEventListener('blur', function () {
    setTimeout(function () {
      var a = document.activeElement;
      if (a && a.tagName === 'IFRAME') { try { a.blur(); } catch (e) {} try { window.focus(); } catch (e) {} }
    }, 0);
  });

  /* ---------------- Tuşlar ---------------- */
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    RED: 403, CH_UP: 427, CH_DOWN: 428, PG_UP: 33, PG_DOWN: 34,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, FF: 417, RW: 412, STOP: 413
  };

  function isBackKey(k, inInput) {
    return k === 10009 || k === 461 || k === 27 || (k === 8 && !inInput);
  }

  var exitArmed = 0;
  function exitApp() {
    if (Date.now() - exitArmed > 2500) { exitArmed = Date.now(); toast('Çıkmak için Geri tuşuna tekrar bas'); return; }
    try { if (window.tizen) { tizen.application.getCurrentApplication().exit(); return; } } catch (e) {}
    try { if (window.webOS && webOS.platformBack) { webOS.platformBack(); return; } } catch (e) {}
    window.close();
  }

  function goBack() {
    var z = zoneOf(document.activeElement), scr = currentScreen();
    if (scr === 'login') { exitApp(); return; }
    if (S.seriesView) {
      if (z === 'cats') { closeSeries(); return; }
      focusEl(S.zoneFocus.cats && S.zoneFocus.cats.offsetParent ? S.zoneFocus.cats : $('#cat-list .cat.active') || $('#cat-list .cat'));
      return;
    }
    if (z === 'items' || z === 'search' || z === 'settings') {
      var c = S.section === 'settings' ? $('.rail-item.active') : ($('#cat-list .cat.active') || $('#cat-list .cat'));
      focusEl(c);
      return;
    }
    if (z === 'cats') { focusEl($('.rail-item.active')); return; }
    exitApp();
  }

  function isPageKey(k) { return k === KEY.PG_DOWN || k === KEY.CH_DOWN || k === KEY.PG_UP || k === KEY.CH_UP; }

  function playerKey(e, k) {
    var type = S.play && S.play.type;
    var dir = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[k];

    // Panel, menü ya da alt çubuk açıkken: kumanda ile gezinme
    if (P.layer) {
      var pa = document.activeElement, pin = pa && pa.tagName === 'INPUT';
      if (pin && (k === KEY.LEFT || k === KEY.RIGHT)) {
        try {
          if ((k === KEY.LEFT && pa.selectionStart > 0) || (k === KEY.RIGHT && pa.selectionStart < pa.value.length)) return;
        } catch (err) {}
      }
      if (pin && k === 8) return;
      if (isBackKey(k, false)) {
        e.preventDefault();
        if (P.layer === 'guide' && G.series && zoneOf(document.activeElement) === 'gitems') { guideCat(G.catId, G.series.idx); return; }
        closeLayer();
        return;
      }
      if (P.layer === 'menu' && (k === KEY.LEFT || k === KEY.RIGHT) && menuAdjust(k === KEY.LEFT ? -1 : 1)) { e.preventDefault(); return; }
      if (P.layer === 'guide' && (k === KEY.RED || k === 70)) { e.preventDefault(); guideToggleFav(); return; }
      if (isPageKey(k)) {
        e.preventDefault();
        for (var n = 0; n < 8; n++) move(k === KEY.PG_DOWN || k === KEY.CH_DOWN ? 'down' : 'up');
        return;
      }
      if (dir) { e.preventDefault(); move(dir); if (P.layer === 'bar') showOsd(); return; }
      if (k === KEY.PLAYPAUSE || k === KEY.PLAY || k === KEY.PAUSE) { e.preventDefault(); togglePause(); }
      return; // OK: odaktaki düğmeye tıklanır
    }

    if (M.on) { multiKey(e, k); return; }
    if (isBackKey(k, false)) { e.preventDefault(); closePlayer(); return; }
    e.preventDefault();
    switch (k) {
      case KEY.ENTER: if (type === 'live') openGuide(); else togglePause(); break;
      case KEY.PLAYPAUSE: togglePause(); break;
      case KEY.PLAY: if (video.paused) togglePause(); break;
      case KEY.PAUSE: if (!video.paused) togglePause(); break;
      case KEY.STOP: closePlayer(); break;
      case KEY.UP: case KEY.DOWN:
        if (type === 'live') zap(k === KEY.UP ? -1 : 1); else openBar(); break;
      case KEY.CH_UP: case KEY.PG_UP: if (type === 'live') zap(-1); else showOsd(); break;
      case KEY.CH_DOWN: case KEY.PG_DOWN: if (type === 'live') zap(1); else showOsd(); break;
      case KEY.LEFT: case KEY.RIGHT:
        if (type === 'live') openBar(); else seek(k === KEY.LEFT ? -10 : 10); break;
      case KEY.RW: seek(-30); break;
      case KEY.FF: seek(30); break;
      default: showOsd();
    }
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, a = document.activeElement;
    var inInput = a && a.tagName === 'INPUT';
    if (currentScreen() === 'player') { playerKey(e, k); return; }
    if (D.open && currentScreen() === 'main') {
      if (isBackKey(k, false)) { e.preventDefault(); closeDetail(); return; }
      if (k === KEY.RED || k === 70) { e.preventDefault(); detailFav(); return; }
      var ddir = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[k];
      if (ddir) { e.preventDefault(); move(ddir); }
      return;
    }
    if (isBackKey(k, inInput)) {
      e.preventDefault();
      if (inInput && k === 27 && a.value && a.id === 'search') { a.value = ''; applyFilter(); return; }
      goBack();
      return;
    }
    if (k === KEY.RED || (k === 70 && !inInput)) { e.preventDefault(); toggleFav(); return; }
    if (k === KEY.PG_DOWN || k === KEY.CH_DOWN || k === KEY.PG_UP || k === KEY.CH_UP) {
      e.preventDefault();
      for (var n = 0; n < 8; n++) move(k === KEY.PG_DOWN || k === KEY.CH_DOWN ? 'down' : 'up');
      return;
    }
    var dir = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[k];
    if (!dir) return;
    if (inInput && (dir === 'left' || dir === 'right')) {
      try {
        var atStart = a.selectionStart === 0 && a.selectionEnd === 0;
        var atEnd = a.selectionStart === a.value.length;
        if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return;
      } catch (err) {}
    }
    e.preventDefault();
    move(dir);
  });

  // İçerik listesinde Enter ile arama kutusundan çıkınca listeye geç
  $('#search').addEventListener('keydown', function (e) {
    if (e.keyCode === 13) { e.preventDefault(); applyFilter(); focusEl($('#items .item')); }
  });
  ['#in-server', '#in-user', '#in-pass'].forEach(function (id, i, arr) {
    $(id).addEventListener('keydown', function (e) {
      if (e.keyCode !== 13) return;
      e.preventDefault();
      if (i < arr.length - 1) focusEl($(arr[i + 1])); else focusEl($('#btn-login'));
    });
  });

  /* ---------------- Platform ---------------- */
  function registerTizenKeys() {
    try {
      if (!window.tizen || !tizen.tvinputdevice) return;
      ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'MediaPlayPause', 'MediaPlay', 'MediaPause',
        'MediaFastForward', 'MediaRewind', 'MediaStop'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    } catch (e) {}
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.play) { savePos(true); video.pause(); }
  });

  /* ---------------- Başlat ---------------- */
  registerTizenKeys();
  if (S.acc) {
    $('#in-server').value = S.acc.server;
    $('#in-user').value = S.acc.user;
    $('#in-pass').value = S.acc.pass;
    showScreen('login');
    doLogin(S.acc);
  } else {
    showScreen('login');
    focusEl($('#in-server'));
  }
  window.XTV_BOOTED = true;
})();
