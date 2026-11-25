"""전국 기차역 게임 데이터 → train/web/data.js

사용법: python3 train/scripts/build_train_data.py

입력 (train/data/raw/)
- korail_station_ridership_2025.csv : 한국철도공사 역별 승하차 현황(2025년 1년 합계)
- ktx_station_ridership_2023.csv     : 한국철도공사 KTX 상하행 역별 승하차(월별) → 역별 KTX 비율
- wikidata_stations.json             : 위키데이터 한국 철도역 좌표(SPARQL 결과)
- skorea_provinces_geo_simple.json   : 시도 경계(통계청 2013, southkorea-maps)
- skorea_municipalities_geo_simple.json : 시군구 경계(같은 출처) → 역이 속한 시군 판정

선로(노선별 역 순서)는 아래 LINES에 직접 적었다. 무궁화~KTX가 서는 역만 넣고,
수도권 전철·도시철도 전용역은 뺀다. 역 사이 모양·거리는 train/data/rail_geom.json(OpenStreetMap 선로,
build_rail_geom.py로 만듦)을 쓰고, 없는 구간만 직선거리 × 선형 보정(CURVE).
"""
import csv, json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'web', 'data.js')

# ───────── 선로 ─────────
# kind: conv(일반선) / hs(고속선). elec: 전철화. dbl: 복선. vmax: 선로 최고속도(km/h)
# 역 이름은 승하차 자료의 역명과 같아야 한다.
LINES = [
    ('gyeongbu', '경부선', 'conv', True, True, 150,
     '서울 용산 영등포 안양 수원 오산 서정리 평택 성환 천안 전의 조치원 부강 신탄진 대전 옥천 이원 지탄 심천 각계 영동 황간 추풍령 김천 구미 약목 왜관 신동 서대구 대구 동대구 경산 남성현 청도 상동 밀양 삼랑진 원동 물금 화명 구포 부산'),
    ('gyeongbu_hs', '경부고속선', 'hs', True, True, 300,
     '서울 광명 천안아산 오송 대전 김천구미 동대구 경주 울산 부산'),
    ('honam_hs', '호남고속선', 'hs', True, True, 300,
     '오송 공주 익산 정읍 광주송정'),
    ('honam', '호남선', 'conv', True, True, 150,
     '대전 서대전 계룡 연산 논산 강경 함열 익산 김제 신태인 정읍 백양사 장성 광주송정 나주 다시 함평 무안 몽탄 일로 임성리 목포'),
    ('gwangju', '광주선', 'conv', True, False, 100, '광주송정 극락강 광주'),
    ('jeolla', '전라선', 'conv', True, True, 150,
     '익산 삼례 전주 임실 오수 남원 곡성 구례구 순천 여천 여수엑스포'),
    ('janghang', '장항선', 'conv', False, False, 120,
     '천안 아산 온양온천 신창 도고온천 신례원 예산 삽교 홍성 광천 청소 대천 웅천 판교(충남) 서천 장항 군산 대야 익산'),
    ('seohae', '서해선', 'conv', True, True, 150, '홍성 합덕 인주 안중 향남 화성시청 서화성'),
    ('chungbuk', '충북선', 'conv', True, False, 120,
     '조치원 오송 청주 오근장 청주공항 증평 음성 주덕 충주 삼탄 봉양 제천'),
    ('jungang', '중앙선', 'conv', True, True, 150,
     '청량리 상봉 덕소 양평 용문 지평 석불 일신 매곡 양동 삼산 서원주 원주 제천 단양 풍기 영주 안동 의성 군위 영천 아화 경주'),
    ('daegu', '대구선', 'conv', True, True, 150, '동대구 하양 영천'),
    ('gangneung', '강릉선', 'hs', True, True, 250, '서원주 만종 횡성 둔내 평창 진부 강릉'),
    ('jungbu', '중부내륙선', 'conv', True, False, 230,
     '판교(경기) 부발 가남 감곡장호원 앙성온천 충주 살미 수안보온천 연풍 문경'),
    ('gyeongbuk', '경북선', 'conv', False, False, 100, '김천 청리 상주 함창 점촌 용궁 개포 예천 영주'),
    ('yeongdong', '영동선', 'conv', True, False, 100,
     '영주 봉화 춘양 임기 현동 분천 양원 승부 석포 철암 동백산 도계 신기 동해 묵호 정동진 강릉'),
    ('taebaek', '태백선', 'conv', True, False, 100, '제천 쌍룡 영월 예미 민둥산 사북 고한 태백 동백산'),
    ('samcheok', '삼척선', 'conv', False, False, 80, '동해 추암 삼척해변 삼척'),
    ('donghae_s', '동해선(부산~포항)', 'conv', True, True, 150,
     '부전 센텀 신해운대 기장 남창 태화강 북울산 경주 서경주 안강 포항'),
    ('donghae_n', '동해선(포항~삼척)', 'conv', False, False, 150,
     '포항 월포 장사 강구 영덕 영해 고래불 후포 평해 기성 매화 울진 죽변 흥부 옥원 임원 근덕 삼척'),
    ('bujeon', '가야선', 'conv', True, True, 100, '부산 부전'),
    ('gyeongjeon_e', '경전선(삼랑진~진주)', 'conv', True, True, 150,
     '삼랑진 한림정 진영 진례 창원중앙 창원 마산 중리 함안 군북 반성 진주'),
    ('gyeongjeon_m', '경전선(진주~순천)', 'conv', False, False, 120, '진주 완사 북천 횡천 하동 진상 광양 순천'),
    ('gyeongjeon_w', '경전선(순천~광주송정)', 'conv', False, False, 100,
     '순천 벌교 조성 예당 득량 보성 명봉 이양 능주 화순 효천 서광주 광주송정'),
    ('namhae', '남해선', 'conv', True, False, 150, '임성리 영암 해남 강진 전남장흥 장동 신보성 보성'),
    ('gyeongui', '경의선', 'conv', True, True, 120, '서울 행신 대곡'),
    ('gyooe', '교외선', 'conv', False, False, 80, '대곡 원릉 일영 장흥 송추 의정부'),
    ('gyeongwon', '경원선', 'conv', True, True, 100, '청량리 의정부 동두천'),
    ('gyeongchun', '경춘선', 'conv', True, True, 180, '상봉 춘천'),
]
CURVE = {'conv': 1.15, 'hs': 1.05}

# 위키데이터에 없거나 같은 이름이 여럿인 역(lon, lat)
COORD_FIX = {
    '경주': (129.138889, 35.798333),   # 옛 신경주역 자리(2021년 이름 변경)
    '서경주': (129.1800141, 35.8849466),
    '양원': (129.092, 36.9648),
    '장동': (126.9961, 34.7538),
    '신기': (129.0780, 37.3550),
    '판교(경기)': (127.111137, 37.394762),
    '김천구미': (128.18, 36.1131),
    '삼산': (127.7797374, 37.3922547),
    '연산': (127.2007488, 36.2122515),
    '용문': (127.5945, 37.4823),
    '대곡': (126.8112, 37.6315),
}
COORD_MID = {'일신': ('석불', '매곡'), '판교(충남)': ('웅천', '서천')}  # 좌표 없음 → 이웃 역 가운데

# 지역(개방 단위). 시군 이름 → 지역. 시작 지역은 대구권
REGIONS = [
    ('daegu', '대구권', ['대구', '경산시', '구미시', '칠곡군', '영천시', '청도군', '김천시', '군위군']),
    ('gyeongbuk_e', '경북 동해안', ['경주시', '포항시', '영덕군', '울진군']),
    ('gyeongbuk_n', '경북 북부', ['안동시', '영주시', '상주시', '문경시', '예천군', '의성군', '봉화군']),
    ('busan', '부산·울산', ['부산', '울산', '양산시']),
    ('gyeongnam', '경남', ['경상남도']),
    ('chungcheong', '대전·충남·세종', ['대전', '충청남도', '세종']),
    ('chungbuk', '충북', ['충청북도']),
    ('capital', '수도권', ['서울', '경기도', '인천']),
    ('gangwon', '강원', ['강원도']),
    ('jeonbuk', '전북', ['전라북도']),
    ('jeonnam', '광주·전남', ['광주', '전라남도']),
]

METRO_WORDS = ('도시철도', '지하철', '수도권 전철', '경전철', '신분당선')


def km(a, b):
    kx = 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.54)


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]; xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def polys(geom):
    return geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]


def locate(x, y, feats):
    for f in feats:
        for p in polys(f['geometry']):
            if point_in_ring(x, y, p[0]):
                return f['properties']
    # 경계 단순화로 해안 역이 밖에 떨어질 수 있음 → 가장 가까운 꼭짓점
    best, bd = None, 1e9
    for f in feats:
        for p in polys(f['geometry']):
            for q in p[0][::3]:
                d = (q[0] - x) ** 2 + (q[1] - y) ** 2
                if d < bd: best, bd = f['properties'], d
    return best


def used_stations():
    used = []
    for *_x, seq in LINES:
        for st in seq.split():
            if st not in used: used.append(st)
    return used


def station_coords():
    """역 이름 → (lon, lat). 위키데이터 + 수동 보정"""
    wd = {}
    for b in json.load(open(os.path.join(RAW, 'wikidata_stations.json'), encoding='utf-8'))['results']['bindings']:
        n = b['sLabel']['value']
        n = n[:-1] if n.endswith('역') else n
        lon, lat = map(float, b['c']['value'][6:-1].split())
        lines = b.get('lines', {}).get('value', '')
        wd.setdefault(n, []).append((lon, lat, lines))

    used = used_stations()
    coord = {}
    for s in used:
        if s in COORD_FIX: coord[s] = COORD_FIX[s]; continue
        if s in COORD_MID: continue
        c = wd.get(s)
        if not c: sys.exit(f'좌표 없음: {s}')
        main_ = [x for x in c if not any(w in x[2] for w in METRO_WORDS)] or c
        coord[s] = main_[0][:2]
    for s, (a, b) in COORD_MID.items():
        coord[s] = ((coord[a][0] + coord[b][0]) / 2, (coord[a][1] + coord[b][1]) / 2)

    return coord


def load_geom():
    """실제 선로 모양·길이(build_rail_geom.py 결과). 없으면 직선"""
    p = os.path.join(ROOT, 'data', 'rail_geom.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}


def main():
    global GEOM
    GEOM = load_geom()
    print(f'실제 선로 모양: {len(GEOM)}개 구간', file=sys.stderr)
    rows = list(csv.DictReader(open(os.path.join(RAW, 'korail_station_ridership_2025.csv'), encoding='utf-8')))
    rid = {r['역명']: (int(r['승차인원']), int(r['하차인원'])) for r in rows}

    # KTX 비율: 2023년 역별 KTX 승차 ÷ 전체 승차(2025)
    ktx = {}
    for r in csv.DictReader(open(os.path.join(RAW, 'ktx_station_ridership_2023.csv'), encoding='utf-8')):
        if r['운행년월'].startswith('2023'):
            n = {'신경주': '경주', '김천(구미)': '김천구미'}.get(r['정차역'], r['정차역'])
            ktx[n] = ktx.get(n, 0) + int(r['하행_승차인원수']) + int(r['상행_승차인원수'])

    used = used_stations()
    missing = [s for s in used if s not in rid]
    if missing: sys.exit(f'승하차 자료에 없는 역: {missing}')
    coord = station_coords()

    muni = json.load(open(os.path.join(RAW, 'skorea_municipalities_geo_simple.json'), encoding='utf-8'))['features']
    prov = json.load(open(os.path.join(RAW, 'skorea_provinces_geo_simple.json'), encoding='utf-8'))['features']
    pcode = {f['properties']['code']: f['properties']['name'] for f in prov}

    def region_of(name):
        lon, lat = coord[name]
        m = locate(lon, lat, muni)
        pn = pcode.get(m['code'][:2], '')
        keys = [m['name'], pn, pn.replace('광역시', '').replace('특별시', '').replace('특별자치시', '')]
        for rid_, _, names in REGIONS:
            for k in keys:
                if any(k == n or (n.endswith(('시', '군')) and k.startswith(n)) for n in names): return rid_, m['name'], pn
        return None, m['name'], pn

    stations = []
    idx = {}
    for s in used:
        reg, si, pn = region_of(s)
        if reg is None: sys.exit(f'지역 판정 실패: {s} {si} {pn}')
        on, off = rid[s]
        idx[s] = len(stations)
        stations.append({'name': s, 'lon': round(coord[s][0], 5), 'lat': round(coord[s][1], 5),
                         'on': round(on / 365), 'off': round(off / 365),
                         'ktx': round(min(1, ktx.get(s, 0) / on), 2) if on else 0,
                         'region': reg, 'si': si})

    # 검사: 이웃 역이 너무 멀거나 지그재그면 알림
    lines_out = []
    for lid, name, kind, elec, dbl, vmax, seq in LINES:
        ss = seq.split()
        segs, geo = [], []
        for a, b in zip(ss, ss[1:]):
            g = GEOM.get(f'{lid}|{a}|{b}')
            d = g['km'] if g else km(coord[a], coord[b]) * CURVE[kind]
            geo.append(g['pts'] if g else None)
            if not g and d > (90 if kind == 'hs' else 45): print(f'  ! {name} {a}-{b} {d:.0f}km', file=sys.stderr)
            segs.append(round(d, 1))
        for a, b, c in zip(ss, ss[1:], ss[2:]):
            if km(coord[a], coord[c]) < 0.6 * max(km(coord[a], coord[b]), km(coord[b], coord[c])):
                print(f'  ! {name} 꺾임: {a}-{b}-{c}', file=sys.stderr)
        lines_out.append({'id': lid, 'name': name, 'kind': kind, 'elec': elec, 'dbl': dbl, 'vmax': vmax,
                          'stations': [idx[s] for s in ss], 'km': segs, 'geom': geo})

    # 지도 배경: 시도 경계(단순화)
    land = []
    for f in prov:
        for p in polys(f['geometry']):
            ring = p[0]
            if len(ring) < 8: continue
            land.append([[round(q[0], 3), round(q[1], 3)] for q in ring[::2]])

    regions = [{'id': r, 'name': n} for r, n, _ in REGIONS]
    total = sum(st['on'] for st in stations)
    print(f'역 {len(stations)}개, 선로 {len(lines_out)}개, 하루 승차 {total:,}명', file=sys.stderr)
    for r in regions:
        ss = [s for s in stations if s['region'] == r['id']]
        print(f"  {r['name']}: 역 {len(ss)}, 하루 승차 {sum(s['on'] for s in ss):,}", file=sys.stderr)

    data = {'stations': stations, 'lines': lines_out, 'regions': regions, 'land': land,
            'source': '한국철도공사 역별 승하차 현황(2025), KTX 역별 승하차(2023), 선로 © OpenStreetMap 기여자(ODbL)'}
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('window.GAME_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'→ {OUT} ({os.path.getsize(OUT):,} bytes)', file=sys.stderr)


if __name__ == '__main__':
    main()
