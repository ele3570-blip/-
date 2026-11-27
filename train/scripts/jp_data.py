"""일본 철도 (게임 확장용: 한일 해저터널 뒤)

- 역 위치·승하차: 국토교통성 국토수치정보 「駅別乗降客数」(S12-24, JR 각 사 역별 하루 승하차, 가장 최근 해) → train/data/raw/jp_stations.json
  [경도, 위도, 하루 승하차]. 같은 이름 역이 여럿이면 승객이 가장 많은 곳(후쿠시마는 후쿠시마시)
- 도(都道府県) 경계: geoBoundaries JPN ADM1(OpenStreetMap, ODbL)을 단순화 → train/data/raw/jpn_adm1.geojson
- 게임 승객은 한국과 균형: 일본 주요역 전체 승차가 한국 전체 승차와 같도록 줄임(build 때 비율 계산)
- 쓰시마·이키는 해저터널 중간의 가상 역(섬 인구로 대략)
"""

TOTAL_RATIO = 1.2  # 일본 주요역 전체 승차 = 한국 전체 × 1.2

FIX = {  # 자료에 0이거나 다른 곳이 잡힌 역: [경도, 위도, 하루 승하차(대략)]
    '후쿠시마': [140.45953, 37.75521, 28584],
    '우레시노온센': [129.99895, 33.10743, 1500],
    '쓰루가': [136.0764, 35.64476, 6000],
    '후쿠이': [136.22251, 36.06041, 16000],
    '쓰시마': [129.33, 34.42, 3000],   # 가상(해저터널)
    '이키': [129.72, 33.78, 2500],     # 가상(해저터널)
}

# (id, 이름, kind(hs 신칸센 / conv 재래선), 전철화, 복선, 최고속도, 역 순서, 나라)  나라: jp 또는 tunnel(KTX·신칸센만)
JP_LINES = [
    ('jp_tunnel', '한일 해저터널', 'hs', True, True, 300, '부산 쓰시마 이키 가라쓰 하카타', 'tunnel'),
    ('jp_kyushu_s', '규슈 신칸센', 'hs', True, True, 260, '하카타 신토스 구루메 구마모토 신야쓰시로 이즈미 가고시마추오', 'jp'),
    ('jp_nishikyushu_s', '니시큐슈 신칸센', 'hs', True, True, 260, '다케오온센 우레시노온센 신오무라 나가사키', 'jp'),
    ('jp_kagoshima', '가고시마 본선', 'conv', True, True, 130, '고쿠라 하카타 신토스', 'jp'),
    ('jp_nagasaki', '나가사키 본선·사세보선', 'conv', True, False, 130, '신토스 다케오온센', 'jp'),
    ('jp_nippo', '닛포 본선', 'conv', True, False, 130, '고쿠라 나카쓰 벳푸 오이타 미야자키', 'jp'),
    ('jp_sanyo_s', '산요 신칸센', 'hs', True, True, 300,
     '하카타 고쿠라 신시모노세키 신야마구치 도쿠야마 히로시마 후쿠야마 오카야마 히메지 신고베 신오사카', 'jp'),
    ('jp_sanin', '하쿠비선·산인 본선', 'conv', True, False, 120, '오카야마 요나고 마쓰에 이즈모시', 'jp'),
    ('jp_yosan', '세토대교선·요산선', 'conv', True, False, 130, '오카야마 다카마쓰 마쓰야마', 'jp'),
    ('jp_kotoku', '고토쿠선', 'conv', False, False, 120, '다카마쓰 도쿠시마', 'jp'),
    ('jp_dosan', '도산선', 'conv', False, False, 120, '오카야마 고치', 'jp'),
    ('jp_kyotokobe', 'JR 교토선·고베선', 'conv', True, True, 130, '히메지 산노미야 오사카 신오사카 교토', 'jp'),
    ('jp_yamatoji', '야마토지선', 'conv', True, True, 120, '오사카 나라', 'jp'),
    ('jp_hanwa', '한와선', 'conv', True, True, 120, '오사카 와카야마', 'jp'),
    ('jp_kansaiap', '간사이공항선', 'conv', True, True, 120, '오사카 간사이공항', 'jp'),
    ('jp_tokaido_s', '도카이도 신칸센', 'hs', True, True, 285,
     '신오사카 교토 마이바라 기후하시마 나고야 도요하시 하마마쓰 시즈오카 미시마 오다와라 신요코하마 시나가와 도쿄', 'jp'),
    ('jp_hokuriku', '호쿠리쿠 본선', 'conv', True, True, 130, '마이바라 쓰루가', 'jp'),
    ('jp_hokuriku_s', '호쿠리쿠 신칸센', 'hs', True, True, 260, '쓰루가 후쿠이 가나자와 도야마 나가노 다카사키 오미야 우에노 도쿄', 'jp'),
    ('jp_chuo', '주오 본선·시노노이선', 'conv', True, False, 130, '나고야 마쓰모토 나가노', 'jp'),
    ('jp_tokaido', '도카이도선(도쿄~요코하마)', 'conv', True, True, 120, '도쿄 시나가와 요코하마', 'jp'),
    ('jp_sobu', '소부선', 'conv', True, True, 120, '도쿄 지바', 'jp'),
    ('jp_utsunomiya', '우쓰노미야선', 'conv', True, True, 120, '도쿄 우에노 오미야 우쓰노미야', 'jp'),
    ('jp_joetsu_s', '조에쓰 신칸센', 'hs', True, True, 240, '오미야 다카사키 에치고유자와 나가오카 니가타', 'jp'),
    ('jp_tohoku_s', '도호쿠 신칸센', 'hs', True, True, 320,
     '도쿄 우에노 오미야 우쓰노미야 고리야마 후쿠시마 센다이 이치노세키 모리오카 하치노헤 신아오모리', 'jp'),
    ('jp_akita_s', '아키타 신칸센', 'hs', True, False, 130, '모리오카 아키타', 'jp'),
    ('jp_yamagata_s', '야마가타 신칸센', 'hs', True, False, 130, '후쿠시마 야마가타', 'jp'),
    ('jp_hokkaido_s', '홋카이도 신칸센', 'hs', True, True, 260, '신아오모리 신하코다테호쿠토', 'jp'),
    ('jp_hakodate', '하코다테 본선', 'conv', False, False, 120, '하코다테 신하코다테호쿠토 삿포로', 'jp'),
]

# 도(geoBoundaries 이름) → 게임 지역 (여는 순서: 규슈 → 주고쿠 → 시코쿠·간사이 → 주부 → 간토 → 도호쿠 → 홋카이도)
JP_REGIONS = [
    ('jp_kyushu', '규슈', ['Fukuoka', 'Saga', 'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima']),
    ('jp_chugoku', '주고쿠', ['Yamaguchi', 'Hiroshima', 'Okayama', 'Tottori', 'Shimane']),
    ('jp_shikoku', '시코쿠', ['Kagawa', 'Tokushima', 'Ehime', 'Kochi']),
    ('jp_kansai', '간사이', ['Hyogo', 'Osaka', 'Kyoto', 'Nara', 'Wakayama', 'Shiga']),
    ('jp_chubu', '주부', ['Aichi', 'Gifu', 'Shizuoka', 'Nagano', 'Niigata', 'Toyama', 'Ishikawa', 'Fukui', 'Yamanashi', 'Mie']),
    ('jp_kanto', '간토', ['Tokyo', 'Kanagawa', 'Saitama', 'Chiba', 'Gunma', 'Ibaraki']),
    ('jp_tohoku', '도호쿠', ['Tochigi', 'Fukushima', 'Miyagi', 'Iwate', 'Aomori', 'Akita', 'Yamagata']),
    ('jp_hokkaido', '홋카이도', ['Hokkaido']),
]
TUNNEL_REGION = ('jp_tunnel', '한일 해저터널')  # 쓰시마·이키: 터널이 개통되면 저절로 열림
