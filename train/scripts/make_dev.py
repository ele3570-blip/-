"""개발자용 페이지 만들기: train/web/index.html → train/web/dev.html
개발자용은 속도 30·100배와 '⏭ 이번 달 마무리' 버튼(ui.js 의 window.RAIL_DEV)
사용법: python3 train/scripts/make_dev.py
"""
import os
web = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')
s = open(os.path.join(web, 'index.html'), encoding='utf-8').read()
mark = '<script src="data.js"></script>'
assert mark in s
s = s.replace(mark, '<script>window.RAIL_DEV = true; // 개발자용</script>\n' + mark, 1)
open(os.path.join(web, 'dev.html'), 'w', encoding='utf-8').write(s)
print('→ train/web/dev.html')
