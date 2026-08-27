#!/usr/bin/env python3
import json, re, sys, zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
REL_NS = {'p': 'http://schemas.openxmlformats.org/package/2006/relationships'}


def col_index(ref):
    letters = re.match(r'([A-Z]+)', ref or '')
    if not letters: return 0
    n = 0
    for c in letters.group(1): n = n * 26 + ord(c) - 64
    return n - 1


def excel_date(value):
    try:
        serial = float(value)
        if serial < 1000: return None
        return (datetime(1899, 12, 30) + timedelta(days=serial)).strftime('%Y-%m-%d')
    except Exception:
        return None


def text(v):
    if v is None: return ''
    return str(v).strip()


def money(v):
    s = text(v).replace(',', '').replace('$', '').replace('NT', '').replace('元', '')
    try: return float(s)
    except Exception: return None


def classify(subject, item, category):
    s = ' '.join([text(subject), text(item), text(category)]).lower()
    income_words = ['銷售', '收入', '經銷', '蝦皮', 'shopee', '官網', '買斷']
    expense_words = ['費用', '支出', '成本', '製作', '運費', '宣傳', '廣告', '公關', '交際', '包材', '物流']
    if any(w in s for w in income_words): return 'INCOME'
    if any(w in s for w in expense_words): return 'EXPENSE'
    return None


def category_code(subject, item, category, direction):
    s = ' '.join([text(subject), text(item), text(category)]).lower()
    if direction == 'INCOME':
        if any(w in s for w in ['經銷', '買斷']): return 'wholesale'
        return 'sales'
    if any(w in s for w in ['製作', '打版', '布料', '加工', '成本']): return 'production'
    if any(w in s for w in ['宣傳', '廣告', '公關', '拍攝', 'kol']): return 'marketing'
    if any(w in s for w in ['運費', '物流', '7-11', '黑貓']): return 'shipping'
    return 'admin'


def parse_workbook(path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in root.findall('m:si', NS):
                shared.append(''.join(t.text or '' for t in si.findall('.//m:t', NS)))
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rel_map = {r.attrib['Id']: r.attrib['Target'] for r in rels.findall('p:Relationship', REL_NS)}
        sheets = []
        for s in wb.findall('m:sheets/m:sheet', NS):
            rid = s.attrib.get('{%s}id' % NS['r'])
            target = rel_map.get(rid, '')
            if target.startswith('/'): xml_path = target.lstrip('/')
            else: xml_path = 'xl/' + target.lstrip('/')
            sheets.append((s.attrib.get('name', ''), xml_path))

        result = []
        for sheet_name, xml_path in sheets:
            if sheet_name not in ('115年收支明細', '發票明細') or xml_path not in z.namelist():
                continue
            root = ET.fromstring(z.read(xml_path))
            rows = []
            for row in root.findall('.//m:sheetData/m:row', NS):
                cells = {}
                for c in row.findall('m:c', NS):
                    idx = col_index(c.attrib.get('r', 'A1'))
                    typ = c.attrib.get('t')
                    v = c.find('m:v', NS)
                    inline = c.find('m:is/m:t', NS)
                    value = ''
                    if inline is not None: value = inline.text or ''
                    elif v is not None:
                        value = v.text or ''
                        if typ == 's':
                            try: value = shared[int(value)]
                            except Exception: pass
                    cells[idx] = value
                rows.append((int(row.attrib.get('r', len(rows)+1)), cells))
            result.extend(normalize_sheet(sheet_name, rows))
        return result


def normalize_sheet(sheet_name, rows):
    if sheet_name == '發票明細':
        return []
    header_row = None
    headers = {}
    for row_no, cells in rows[:40]:
        vals = {i: text(v) for i, v in cells.items()}
        joined = '|'.join(vals.values())
        if '日期' in joined and ('科目' in joined or '收支項目' in joined) and ('金額' in joined or '收入' in joined):
            header_row = row_no
            headers = vals
            break
    if header_row is None: return []

    def find_col(*needles):
        for i, h in headers.items():
            if any(n in h for n in needles): return i
        return None

    c_date = find_col('日期')
    c_subject = find_col('科目')
    c_item = find_col('收支項目')
    c_category = find_col('類別')
    c_counterparty = find_col('經銷', '店家', '廠商')
    c_product = find_col('產品名稱', '商品名稱')
    c_size = find_col('尺寸')
    c_qty = find_col('件數', '數量')
    c_amount = find_col('收入', '金額')
    c_note = find_col('備註')

    out = []
    for row_no, cells in rows:
        if row_no <= header_row: continue
        get = lambda c: cells.get(c, '') if c is not None else ''
        amount = money(get(c_amount))
        subject, item, category = text(get(c_subject)), text(get(c_item)), text(get(c_category))
        product = text(get(c_product))
        if not any([amount, subject, item, product]): continue
        raw_date = get(c_date)
        date = excel_date(raw_date) or text(raw_date)
        if re.match(r'^\d{1,2}/\d{1,2}$', date): date = '2026-' + '-'.join(x.zfill(2) for x in date.split('/'))
        if re.match(r'^\d{1,2}/\d{1,2}/\d{2,4}$', date):
            parts = date.split('/')
            y = int(parts[2]); y = y + 1911 if y < 1911 else y
            date = f'{y:04d}-{int(parts[0]):02d}-{int(parts[1]):02d}'
        direction = classify(subject, item, category)
        reasons = []
        if not amount or amount <= 0: reasons.append('缺少有效金額')
        if not direction: reasons.append('無法判斷收入 / 支出')
        if not re.match(r'^2026-\d{2}-\d{2}$', date or ''): reasons.append('日期需要確認')
        status = 'READY' if not reasons else ('REJECTED' if not amount else 'REVIEW')
        qty = money(get(c_qty))
        normalized = {
            'occurredAt': date or None,
            'direction': direction,
            'amount': amount,
            'categoryCode': category_code(subject, item, category, direction) if direction else None,
            'counterparty': text(get(c_counterparty)) or item or None,
            'note': text(get(c_note)) or None,
            'items': ([{'productName': product, 'size': text(get(c_size)) or None, 'quantity': int(qty or 1), 'lineAmount': amount}] if product and amount else []),
        }
        out.append({'sheetName': sheet_name, 'rowNumber': row_no, 'status': status, 'reason': '；'.join(reasons) or None, 'raw': {str(k): text(v) for k,v in cells.items()}, 'normalized': normalized})
    return out


def main():
    if len(sys.argv) != 2:
        print(json.dumps({'error': 'xlsx path required'}, ensure_ascii=False)); sys.exit(2)
    rows = parse_workbook(sys.argv[1])
    counts = {k: sum(1 for r in rows if r['status'] == k) for k in ('READY','REVIEW','REJECTED')}
    print(json.dumps({'summary': {'total': len(rows), **counts}, 'rows': rows[:1000]}, ensure_ascii=False))

if __name__ == '__main__': main()
