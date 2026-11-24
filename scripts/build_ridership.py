"""대구 버스 정류소별 승하차 원본 CSV(월별)를 하나의 정리된 표로 합친다.

입력: data/raw/ridership_YYYY-MM.csv  (2024년: UTF-8+합계열, 2025년: CP949, 합계열 없음)
출력:
  data/ridership_long.csv   월, 정류소ID, 정류소명, 구분, 05시..23시, 합계(=시간대합)
  data/stops_summary.csv    정류소별 월평균 승차/하차, 구(ID 앞자리 기준)
  data/hourly_profile.csv   월별 시간대 승차 비율(%)
"""
import csv, glob, os, re, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOURS = [f"{h:02d}시" for h in range(5, 24)]
GU = {"7001": "중구", "7011": "동구", "7021": "북구", "7031": "서구", "7041": "달서구",
      "7051": "남구", "7061": "수성구", "7111": "달성군", "7361": "군위군"}


def read_rows(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return list(csv.DictReader(text.splitlines()))


def main():
    long_rows, stop = [], collections.defaultdict(lambda: {"name": "", "승차": 0, "하차": 0, "months": set()})
    profile = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "data/raw/ridership_*.csv"))):
        month = re.search(r"(\d{4}-\d{2})", path).group(1)
        hour_tot = [0] * len(HOURS)
        for r in read_rows(path):
            if r.get("구분") not in ("승차", "하차"):
                continue  # 빈 줄 등

            vals = [int(r[h] or 0) for h in HOURS]
            total = sum(vals)  # 원본 합계열은 시간대 합과 어긋나는 경우가 많아 시간대 합을 기준으로 함
            long_rows.append([month, r["정류소ID"], r["정류소명"], r["구분"], *vals, total])
            s = stop[r["정류소ID"]]
            s["name"] = r["정류소명"]
            s[r["구분"]] += total
            s["months"].add(month)
            if r["구분"] == "승차":
                hour_tot = [a + b for a, b in zip(hour_tot, vals)]
        t = sum(hour_tot) or 1
        profile[month] = [round(v / t * 100, 2) for v in hour_tot]
        print(month, "승차", sum(hour_tot))

    with open(os.path.join(ROOT, "data/ridership_long.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["월", "정류소ID", "정류소명", "구분", *HOURS, "합계"])
        w.writerows(long_rows)

    with open(os.path.join(ROOT, "data/stops_summary.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["정류소ID", "정류소명", "구(ID기준)", "월평균승차", "월평균하차", "데이터개월수"])
        for sid, s in sorted(stop.items(), key=lambda kv: -kv[1]["승차"]):
            n = len(s["months"])
            w.writerow([sid, s["name"], GU.get(sid[:4], "기타"), round(s["승차"] / n), round(s["하차"] / n), n])

    with open(os.path.join(ROOT, "data/hourly_profile.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["월", *HOURS])
        for m, p in profile.items():
            w.writerow([m, *p])


if __name__ == "__main__":
    main()
