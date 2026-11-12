# Build the warehouse stock map used by the marketplace stock sync.
# Sum of "Ending" over NORMAL warehouses (Bintaro + Gunung Sindur) per item, "BALLOP " prefix removed.
#   python -I tools/daily/wh-map.py "<Stock DD.MM.xlsx>" <out.json>
import sys, json, collections, openpyxl

src, out = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src, read_only=True).active
wh = collections.defaultdict(int)
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[1] and r[3] and 'NORMAL' in str(r[3]):
        wh[str(r[1]).replace('BALLOP ', '', 1)] += int(r[9] or 0)
json.dump(wh, open(out, 'w', encoding='utf8'), separators=(',', ':'), ensure_ascii=False)
print(len(wh), 'items, total', sum(wh.values()), '->', out)
