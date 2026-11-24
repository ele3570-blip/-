"""정류소 위치(위경도, 행정동, 경유노선) + 정류소별 승하차를 합쳐 행정동 단위 게임 수치를 만든다.

위치 파일에는 정류소ID가 없어 정류소명(공백·괄호 등 제거)으로 연결한다.
같은 이름이 여러 위치(보통 길 양쪽)에 있으면 승하차를 위치 수만큼 나눠 배분한다.
정류소 행정동은 위경도를 행정동 경계(daegu_dong.geojson)에 넣어 판정하고,
경계 밖이면 위치 파일의 '동' 값을 쓴다.

출력:
  data/stops_geo.csv   정류소(위치 기준) + 좌표 + 행정동 + 배분된 하루평균 승하차 + 경유노선
  data/dong_stats.csv  행정동별 정류소 수, 하루평균 승차/하차, 노선 수, 중심 좌표
"""
import csv, json, os, re, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, "data", *a)
norm = lambda s: re.sub(r"[\s()·.\-]", "", s)


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def load_dongs():
    dongs = []
    for f in json.load(open(P("daegu_dong.geojson"), encoding="utf-8"))["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        xs = [p[0] for poly in polys for p in poly[0]]
        ys = [p[1] for poly in polys for p in poly[0]]
        dongs.append({"name": f["properties"]["adm_nm"], "code": f["properties"]["adm_cd2"],
                      "polys": polys, "bbox": (min(xs), min(ys), max(xs), max(ys))})
    return dongs


def find_dong(dongs, x, y):
    for d in dongs:
        x0, y0, x1, y1 = d["bbox"]
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        for poly in d["polys"]:
            if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
                return d
    return None


def main():
    dongs = load_dongs()
    by_full = {d["name"]: d for d in dongs}

    ride = collections.defaultdict(lambda: [0, 0])
    for r in csv.DictReader(open(P("stops_summary.csv"), encoding="utf-8-sig")):
        k = norm(r["정류소명"])
        ride[k][0] += int(r["월평균승차"])
        ride[k][1] += int(r["월평균하차"])

    loc = list(csv.DictReader(open(P("raw", "stops_location_20260902.csv"), encoding="utf-8-sig")))
    name_cnt = collections.Counter(norm(r["정류소명"]) for r in loc)

    out, fallback = [], 0
    for r in loc:
        x, y = float(r["경도"]), float(r["위도"])
        d = find_dong(dongs, x, y)
        if d is None:
            d = by_full.get(f"{r['시도']} {r['구군']} {r['동']}")
            fallback += 1
        k = norm(r["정류소명"])
        on, off = ride.get(k, (0, 0))
        n = name_cnt[k]
        out.append({"정류소명": r["정류소명"], "경도": x, "위도": y,
                    "구군": d["name"].split(" ")[1] if d else r["구군"],
                    "행정동": d["name"].split(" ", 2)[2] if d else r["동"],
                    "행정동코드": d["code"] if d else "",
                    "하루평균승차": round(on / n, 1), "하루평균하차": round(off / n, 1),
                    "승하차매칭": "Y" if k in ride else "N",
                    "경유노선": r["경유노선"]})

    with open(P("stops_geo.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    agg = {}
    for s in out:
        key = (s["구군"], s["행정동"])
        a = agg.setdefault(key, {"code": s["행정동코드"], "n": 0, "on": 0.0, "off": 0.0,
                                 "routes": set(), "xs": [], "ys": []})
        a["n"] += 1
        a["on"] += s["하루평균승차"]
        a["off"] += s["하루평균하차"]
        a["routes"].update(x for x in s["경유노선"].split("+") if x)
        a["xs"].append(s["경도"])
        a["ys"].append(s["위도"])

    with open(P("dong_stats.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["구군", "행정동", "행정동코드", "정류소수", "하루평균승차", "하루평균하차",
                    "경유노선수", "중심경도", "중심위도"])
        for (gu, dong), a in sorted(agg.items(), key=lambda kv: -kv[1]["on"]):
            w.writerow([gu, dong, a["code"], a["n"], round(a["on"]), round(a["off"]), len(a["routes"]),
                        round(sum(a["xs"]) / a["n"], 6), round(sum(a["ys"]) / a["n"], 6)])

    matched = sum(1 for s in out if s["승하차매칭"] == "Y")
    print(f"정류소 {len(out)}개, 승하차 매칭 {matched}개, 경계 밖(동 이름으로 대체) {fallback}개, 행정동 {len(agg)}개")


if __name__ == "__main__":
    main()
