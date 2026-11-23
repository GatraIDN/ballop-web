"""Stok gudang (stock_balance / Stock DD.MM.xlsx) -> file import Stock Count BigSeller.

Pakai:
  python -I tools/daily/bigseller-stock.py "<stock file>" <out dir> [<BigSeller counting export.xlsx>]

Hasil di <out dir>:
  bs-count-skus.xlsx     -> Stock Count > Add Count Task > By Merchant SKU > Import & Update
  bs-count-results.xlsx  -> (task Counting) Import & Export > Import Counting > Finish Counting
  bs-new-skus.xlsx       -> hanya kalau ada item gudang yang belum punya Merchant SKU
                            (Merchant SKU > Import & Export > Create Merchant SKU), lalu mapping manual.

Merchant SKU = kode Pickpack (GBI-SPRT-xxxxxx) dari C:/Claude/gudang-ballop/Gudang-Ballop.xlsx (sheet Master SKU).
Stok = Ending gudang NORMAL (sama seperti wh-map.py). Kolom On Hand diambil dari export counting BigSeller
kalau diberikan, kalau tidak diisi sama dengan Count.
"""
import json
import os
import subprocess
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = 'C:/Claude/gudang-ballop/Gudang-Ballop.xlsx'


def master_codes():
    rows = list(openpyxl.load_workbook(MASTER, read_only=True)['Master SKU'].iter_rows(values_only=True))[2:]
    by = {}
    for r in rows:
        if r[0] and r[1]:
            by.setdefault(r[1].replace('BALLOP ', '', 1).strip(), []).append(r[0])
    return {k: sorted(v)[0] for k, v in by.items()}


def onhand_from_export(path):
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h or '') for h in rows[0]]
    si = next(i for i, h in enumerate(hdr) if 'SKU' in h)
    oi = next(i for i, h in enumerate(hdr) if 'On Hand' in h)
    return {r[si]: r[oi] for r in rows[1:] if r[si]}


def sheet(headers, rows, path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'sheet'
    ws.append(headers)
    for r in rows:
        ws.append(r)
    wb.save(path)


def main():
    stock, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    whj = os.path.join(out, 'wh.json')
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'wh-map.py'), stock, whj], check=True)
    wh = json.load(open(whj, encoding='utf8'))
    codes = master_codes()
    onhand = onhand_from_export(sys.argv[3]) if len(sys.argv) > 3 else {}
    have = [(k, q) for k, q in wh.items() if k in codes]
    new = [(k, q) for k, q in wh.items() if k not in codes]
    sheet(['*SKU Name(Required)'], [[codes[k]] for k, _ in have], os.path.join(out, 'bs-count-skus.xlsx'))
    sheet(['*SKU Name(Require)', 'Title', '*Warehouse(Require)', 'Shelf', '*On Hand(Required)', '*Count(Required)', 'Note'],
          [[codes[k], 'BALLOP ' + k, 'Default Warehouse', 'Default Shelf', int(onhand.get(codes[k], q)), int(q), '']
           for k, q in have], os.path.join(out, 'bs-count-results.xlsx'))
    if new:
        sheet(['*SKU Name(Required)', '*Title(Required)'], [['', 'BALLOP ' + k] for k, _ in new], os.path.join(out, 'bs-new-skus.xlsx'))
    print(f'{len(have)} SKU, total stok {sum(q for _, q in have)}')
    if new:
        print(f'{len(new)} item gudang belum ada kode Pickpack/Merchant SKU (cek manual): ' + '; '.join(k for k, _ in new[:10]))


if __name__ == '__main__':
    main()
