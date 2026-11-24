# 대구 버스 경영 (프로토타입)

실제 대구 시내버스 데이터로 만든 버스 회사 경영 게임입니다.

## 실행
`web/index.html`을 브라우저로 열면 됩니다. 서버는 필요 없고, 진행 상황은 브라우저(localStorage)에 하루 단위로 저장됩니다.

## 데이터 다시 만들기
```
python3 scripts/build_ridership.py   # 승하차 원본(data/raw/ridership_*.csv) → 정리 표
python3 scripts/build_dong.py        # 정류소 위치 + 승하차 → 행정동별 수치
python3 scripts/build_game_data.py   # → web/data.js
```

## 데이터 출처
- 정류소별 시간대 승하차 (2024-01 ~ 2025-12, 월별 하루 평균): 공공데이터포털
- 정류소 위치·경유노선 (2026-09-02): 공공데이터포털
- 행정동 경계: vuski/admdongkor (ver20261001)
- 도로: © OpenStreetMap 기여자 (ODbL), 2026-11-23 한국 추출본 → `python3 scripts/build_roads.py <파일.osm.pbf>` 로 `web/roads.js` 생성

## 밸런스
`web/game.js` 맨 위 `CFG`에서 요금, 버스 가격, 운영비, 지역 개방 비용, 수요 배율을 조정합니다.
