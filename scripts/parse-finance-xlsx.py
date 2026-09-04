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


def classify(subject, detail, summary):
    s_subject = text(subject).lower()
    if '銷售' in s_subject or s_subject == '收入': return 'INCOME'
    if '支出' in s_subject: return 'EXPENSE'
    s = ' '.join([s_subject, text(detail), text(summary)]).lower()
    income_words = ['銷售', '收入', '經銷', '蝦皮', 'shopee', '官網', '買斷']
    expense_words = ['費用', '支出', '成本', '製作', '運費', '宣傳', '廣告', '公關', '交際', '包材', '物流', '拍攝']
    if any(w in s for w in income_words): return 'INCOME'
    if any(w in s for w in expense_words): return 'EXPENSE'
    return None


def normalize_sales_channel(detail):
    value = text(detail)
    aliases = {
        'ＩＧ': 'IG', 'ig': 'IG', 'instagram': 'IG',
        '蝦皮': '蝦皮', 'shopee': '蝦皮', '官網': '官網',
        '經銷': '經銷', '親友': '親友', '家人/朋友': '親友', '其他收入': '其他',
    }
    return aliases.get(value.lower(), aliases.get(value, value or None))


def expense_category_code(detail, summary):
    d = text(detail).lower()
    s = f'{d} {text(summary).lower()}'
    if '再製' in s: return 'rework'
    if '進貨運費' in s: return 'inbound_shipping'
    if '出貨運費' in s: return 'shipping'
    if '公關品' in s: return 'pr'
    if '租棚' in s: return 'studio'
    if '拍攝' in s or '麻豆' in s or '模特' in s: return 'photography'
    if '廣告' in s: return 'ads'
    if '製作' in s or '打版' in s or '布料' in s or '加工' in s: return 'production'
    if '包裝' in s or '文具' in s or '破壞袋' in s: return 'packaging'
    if '會計' in s: return 'accounting'
    if any(w in s for w in ['網域', '主機', '軟體', 'gandi', 'hosting']): return 'software'
    if any(w in s for w in ['會費', '入會費', '公會']): return 'membership'
    return 'other'


def infer_expense_counterparty(detail, summary):
    d = text(detail)
    match = re.search(r'製作[（(]([^）)]+)[）)]', d)
    if match and match.group(1).strip() not in ('其他', ''):
        return match.group(1).strip()
    s = text(summary).lower()
    if '7-11' in s or '店到店' in s: return '7-11'
    if '郵局' in s: return '郵局'
    if '黑貓' in s: return '黑貓宅急便'
    return None


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
        if '日期' in joined and '科目' in joined and ('收支細項' in joined or '收支項目' in joined) and ('金額' in joined or '收入' in joined):
            header_row = row_no
            headers = vals
            break
    if header_row is None: return []

    def find_col(*needles):
        for i, h in headers.items():
            if any(n in h for n in needles): return i
        return None

    def find_exact(*names):
        for i, h in headers.items():
            if h in names: return i
        return None

    c_date = find_col('日期')
    c_subject = find_exact('科目')
    c_detail = find_col('收支細項', '收支項目')
    c_product_category = find_exact('類別')
    c_related_party = find_col('經銷/店家', '經銷', '店家', '廠商')
    c_summary = find_exact('項目')
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
        subject = text(get(c_subject))
        detail = text(get(c_detail))
        summary = text(get(c_summary))
        product_category = text(get(c_product_category))
        product = text(get(c_product))
        related_party = text(get(c_related_party))
        if not any([amount, subject, detail, summary, product]): continue
        raw_date = get(c_date)
        date = excel_date(raw_date) or text(raw_date)
        if re.match(r'^\d{1,2}/\d{1,2}$', date): date = '2026-' + '-'.join(x.zfill(2) for x in date.split('/'))
        if re.match(r'^\d{1,2}/\d{1,2}/\d{2,4}$', date):
            parts = date.split('/')
            y = int(parts[2]); y = y + 1911 if y < 1911 else y
            date = f'{y:04d}-{int(parts[0]):02d}-{int(parts[1]):02d}'
        direction = classify(subject, detail, summary)
        reasons = []
        if amount is None or amount == 0: reasons.append('缺少有效金額')
        if amount is not None and amount < 0: reasons.append('負數交易需人工確認為退款 / 折讓')
        if not direction: reasons.append('無法判斷收入 / 支出')
        if not re.match(r'^2026-\d{2}-\d{2}$', date or ''): reasons.append('日期需要確認')
        status = 'READY' if not reasons else ('REJECTED' if amount is None or amount == 0 else 'REVIEW')
        qty = money(get(c_qty))
        if qty is not None and qty < 0:
            if '負數交易需人工確認為退款 / 折讓' not in reasons: reasons.append('負數數量需人工確認為退款 / 退貨')
            status = 'REVIEW'

        sales_channel = normalize_sales_channel(detail) if direction == 'INCOME' else None
        category_code = ('wholesale' if sales_channel == '經銷' else 'sales') if direction == 'INCOME' else (expense_category_code(detail, summary) if direction == 'EXPENSE' else None)
        counterparty = (related_party or None) if direction == 'INCOME' else infer_expense_counterparty(detail, summary)
        normalized = {
            'occurredAt': date or None,
            'direction': direction,
            'amount': abs(amount) if amount is not None else None,
            'categoryCode': category_code,
            'salesChannel': sales_channel,
            'counterparty': counterparty,
            'relatedParty': related_party or None if direction == 'EXPENSE' else None,
            'summary': summary or None,
            'productCategory': product_category or None,
            'note': text(get(c_note)) or None,
            'items': ([{'productName': product, 'size': text(get(c_size)) or None, 'quantity': abs(int(qty or 1)), 'lineAmount': abs(amount)}] if product and amount not in (None, 0) else []),
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
