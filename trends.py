#!/usr/bin/env python3
"""XtreamTV trend listeleri.

GitHub Actions her gün bu betiği çalıştırır ve trends.json dosyasını üretir.
TV uygulaması yalnızca bu dosyayı okur; anahtar TV'ye girilmez.

Kaynaklar:
  - Netflix Top 10 (ülke bazında, haftalık): anahtar gerekmez.
  - TMDB (platformlara yeni gelenler, ülkelerde popüler, haftanın trendleri):
    depo ayarlarındaki TMDB_KEY gizli değişkeni varsa kullanılır.
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

NETFLIX_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv'
TMDB = 'https://api.themoviedb.org/3/'
IMG = 'https://image.tmdb.org/t/p/'
COUNTRIES = [('TR', 'Türkiye'), ('DE', 'Almanya')]
IN_COUNTRY = {'TR': 'Türkiye’de', 'DE': 'Almanya’da'}

# Platform adı, TMDB'deki adını yakalayan desen, bölge, ekranda görünen ad
PLATFORMS = [
    ('netflix', r'^netflix$', 'TR', 'Netflix’te yeni'),
    ('prime', r'^amazon prime video$', 'TR', 'Prime Video’da yeni'),
    ('disney', r'^disney plus$|^disney\+$', 'TR', 'Disney+’ta yeni'),
    ('apple', r'^apple tv\+?$|^apple tv plus$', 'TR', 'Apple TV+’ta yeni'),
    ('exxen', r'^exxen$', 'TR', 'Exxen’de yeni'),
    ('max', r'^hbo max$|^max$|^blutv$', 'TR', 'HBO Max’te yeni'),
    ('tabii', r'^tabii$', 'TR', 'tabii’de yeni'),
    ('hulu', r'^hulu$', 'US', 'Hulu’da yeni (ABD)'),
]

KEY = os.environ.get('TMDB_KEY', '').strip()
UA = {'User-Agent': 'XtreamTV-trends/1.0'}


def fetch(url, headers=None, tries=3):
    """İnternetten oku; testlerde bu fonksiyon değiştirilir."""
    h = dict(UA)
    h.update(headers or {})
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - ağ hataları tekrar denenir
            if i == tries - 1:
                raise
            print('tekrar deneniyor:', url.split('?')[0], e, file=sys.stderr)
            time.sleep(3 * (i + 1))


def tmdb(path, **params):
    params.setdefault('language', 'tr-TR')
    headers = {}
    if len(KEY) > 40:          # v4 "okuma erişim belirteci"
        headers['Authorization'] = 'Bearer ' + KEY
    else:                       # v3 API anahtarı
        params['api_key'] = KEY
    url = TMDB + path + '?' + urllib.parse.urlencode(params)
    return json.loads(fetch(url, headers))


def year_of(d):
    m = re.match(r'(\d{4})', d or '')
    return int(m.group(1)) if m else None


def item_from_tmdb(x, kind):
    title = x.get('title') or x.get('name') or ''
    orig = x.get('original_title') or x.get('original_name') or ''
    date = x.get('release_date') or x.get('first_air_date') or ''
    it = {
        't': title, 'o': orig if orig != title else '', 'y': year_of(date),
        'd': (x.get('overview') or '')[:600],
        'r': round(float(x.get('vote_average') or 0), 1) or None,
        'id': x.get('id'), 'k': kind,
    }
    if x.get('poster_path'):
        it['p'] = IMG + 'w342' + x['poster_path']
    if x.get('backdrop_path'):
        it['b'] = IMG + 'w1280' + x['backdrop_path']
    return {k: v for k, v in it.items() if v not in (None, '')}


# ---------------- Netflix Top 10 ----------------
def _pick(headers, *tests):
    """Netflix dosyasındaki sütunu adına bakarak bul (küçük ad farklarına dayanıklı)."""
    for h in headers:
        if all(t(h) for t in tests):
            return h
    return None


def netflix_top10():
    """Her ülke için en son haftanın film ve dizi Top 10'u."""
    raw = fetch(NETFLIX_TSV).decode('utf-8-sig', 'replace')
    reader = csv.reader(io.StringIO(raw), delimiter='\t')
    headers = [h.strip().lower() for h in next(reader)]
    c_iso = _pick(headers, lambda h: 'iso' in h)
    c_country = _pick(headers, lambda h: 'country' in h, lambda h: 'iso' not in h)
    c_week = _pick(headers, lambda h: 'week' in h, lambda h: 'cumulative' not in h, lambda h: 'rank' not in h)
    c_cat = _pick(headers, lambda h: 'category' in h)
    c_rank = _pick(headers, lambda h: 'rank' in h)
    c_title = _pick(headers, lambda h: 'title' in h, lambda h: 'season' not in h)
    c_season = _pick(headers, lambda h: 'season' in h)
    c_weeks = _pick(headers, lambda h: 'cumulative' in h)
    if not (c_week and c_cat and c_rank and c_title and (c_iso or c_country)):
        raise ValueError('Netflix dosyasının sütunları tanınamadı: %s' % headers)
    names = {'TR': ('turkey', 'türkiye', 'turkiye'), 'DE': ('germany', 'deutschland')}
    want = {c for c, _ in COUNTRIES}
    best = {}  # (ülke, tür) -> (hafta, [satırlar])
    for vals in reader:
        if len(vals) < len(headers):
            continue
        r = dict(zip(headers, (v.strip() for v in vals)))
        iso = r.get(c_iso, '').upper() if c_iso else ''
        if not iso and c_country:
            cn = r.get(c_country, '').lower()
            iso = next((k for k, v in names.items() if cn in v), '')
        if iso not in want:
            continue
        kind = 'movie' if r.get(c_cat, '').lower().startswith('film') else 'tv'
        week = r.get(c_week, '')
        key = (iso, kind)
        if key not in best or week > best[key][0]:
            best[key] = (week, [])
        if week == best[key][0]:
            best[key][1].append(r)
    out = {}
    for (iso, kind), (week, items) in best.items():
        def rank(r):
            try:
                return int(r.get(c_rank) or 99)
            except ValueError:
                return 99
        items.sort(key=rank)
        out[(iso, kind)] = (week, [{
            't': r.get(c_title, ''), 'n': rank(r),
            's': (r.get(c_season, '') if c_season else '') if (r.get(c_season, '') if c_season else '') not in ('', 'N/A') else '',
            'w': int(r.get(c_weeks) or 0) if c_weeks and (r.get(c_weeks) or '').isdigit() else None, 'k': kind,
        } for r in items[:10]])
    return out


def enrich(it):
    """Netflix başlığını TMDB ile eşleştir: Türkçe ad, afiş, konu."""
    if not KEY:
        return it
    try:
        res = tmdb('search/' + it['k'], query=it['t']).get('results') or []
    except Exception as e:  # noqa: BLE001
        print('TMDB arama hatası:', it['t'], e, file=sys.stderr)
        return it
    if not res:
        return it
    rich = item_from_tmdb(res[0], it['k'])
    rich['n'] = it['n']
    if it['t'] not in (rich.get('t'), rich.get('o')):
        rich['a'] = it['t']   # eşleştirme için Netflix'teki adı da sakla
    if it.get('w'):
        rich['w'] = it['w']
    return rich


# ---------------- TMDB ----------------
def provider_ids(kind, region):
    data = tmdb('watch/providers/' + kind, watch_region=region)
    return {p['provider_name'].strip().lower(): p['provider_id'] for p in data.get('results', [])}


def discover(kind, pages=2, **params):
    items, seen = [], set()
    for page in range(1, pages + 1):
        data = tmdb('discover/' + kind, page=page, **params)
        for x in data.get('results', []):
            if x['id'] in seen:
                continue
            seen.add(x['id'])
            items.append(item_from_tmdb(x, kind))
    return items


def tmdb_sections(kind):
    today = dt.date.today()
    since = (today - dt.timedelta(days=180)).isoformat()
    date_key = 'primary_release_date' if kind == 'movie' else 'first_air_date'
    secs = []
    for iso, name in COUNTRIES:
        secs.append({'id': 'pop-' + iso.lower(), 'title': IN_COUNTRY[iso] + ' popüler',
                     'items': discover(kind, watch_region=iso, with_watch_monetization_types='flatrate|free|ads',
                                       sort_by='popularity.desc', **{'vote_count.gte': 20})})
    trend = tmdb('trending/' + kind + '/week').get('results', [])
    secs.append({'id': 'world', 'title': 'Dünyada bu hafta', 'items': [item_from_tmdb(x, kind) for x in trend]})
    providers = {}
    for pid, pattern, region, label in PLATFORMS:
        if region not in providers:
            providers[region] = provider_ids(kind, region)
        match = [v for n, v in providers[region].items() if re.search(pattern, n)]
        if not match:
            print('platform bulunamadı:', label, region, file=sys.stderr)
            continue
        items = discover(kind, watch_region=region, with_watch_providers=match[0],
                         with_watch_monetization_types='flatrate|free|ads', sort_by='popularity.desc',
                         **{date_key + '.gte': since, date_key + '.lte': today.isoformat()})
        if items:
            secs.append({'id': 'p-' + pid, 'title': label, 'items': items})
    return secs


def build():
    data = {'updated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'movie': [], 'tv': [], 'notes': []}
    try:
        top = netflix_top10()
        for kind in ('movie', 'tv'):
            for iso, name in COUNTRIES:
                if (iso, kind) not in top:
                    continue
                week, items = top[(iso, kind)]
                data[kind].append({'id': 'nf-' + iso.lower(), 'title': 'Netflix ' + name + ' Top 10',
                                   'week': week, 'ranked': True, 'items': [enrich(i) for i in items]})
    except Exception as e:  # noqa: BLE001
        data['notes'].append('Netflix Top 10 alınamadı: %s' % e)
    if KEY:
        for kind in ('movie', 'tv'):
            try:
                data[kind].extend(tmdb_sections(kind))
            except Exception as e:  # noqa: BLE001
                data['notes'].append('TMDB (%s) alınamadı: %s' % (kind, e))
    else:
        data['notes'].append('TMDB_KEY tanımlı değil: yalnızca Netflix Top 10 listeleri var.')
    for kind in ('movie', 'tv'):
        data[kind] = [s for s in data[kind] if s.get('items')]
    return data


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'trends.json'
    result = build()
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
    print(out, 'yazıldı:', {k: [(s['id'], len(s['items'])) for s in result[k]] for k in ('movie', 'tv')}, result['notes'])
