#!/usr/bin/env python3
import argparse
import copy
import json
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BASE_ITEM_START = 13
BASE_ITEM_END = 24
BASE_PAYMENT_ROW = 29


def border_style(color="C8C8C8", style="thin"):
    side = Side(style=style, color=color)
    return Border(left=side, right=side, top=side, bottom=side)


def merge(ws, cell_range, value=None, alignment=None):
    ws.merge_cells(cell_range)
    cell = ws[cell_range.split(":")[0]]
    if value is not None:
        cell.value = value
    if alignment:
        cell.alignment = alignment
    return cell


def build_fallback_template():
    wb = Workbook()
    ws = wb.active
    ws.title = "範本"
    ws.sheet_view.showGridLines = False
    widths = {"A": 13, "B": 14, "C": 11, "D": 11, "E": 13, "F": 13, "G": 12, "H": 12, "I": 14}
    for col, width in widths.items():
        ws.column_dimensions[col].width = width
    for row in range(1, 38):
        ws.row_dimensions[row].height = 22
    ws.row_dimensions[1].height = 8
    for row in (2, 3, 4):
        ws.row_dimensions[row].height = 27
    ws.row_dimensions[5].height = 26
    ws.row_dimensions[6].height = 44
    ws.row_dimensions[34].height = 54
    ws.row_dimensions[36].height = 86

    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    section_fill = PatternFill("solid", fgColor="E7E7E7")
    blue_fill = PatternFill("solid", fgColor="D9E7F2")
    thin = border_style()
    outer_side = Side(style="medium", color="222222")

    for row in range(2, 38):
        for col in range(1, 10):
            cell = ws.cell(row, col)
            cell.border = thin
            cell.font = Font(name="Noto Sans CJK TC", size=10)
            cell.alignment = left

    merge(ws, "A2:D4", "Neverland", center).font = Font(name="Georgia", size=19, bold=True)
    merge(ws, "E2:I2", "奈文良多有限公司|統一編號 60343390", left)
    merge(ws, "E3:I3", "負責人: 柯怡安  聯絡電話: 0972-211-049", left)
    merge(ws, "E4:I4", "Email:neverland1332@gmail.com", left)
    merge(ws, "A5:I5", "請     款     單", center).font = Font(name="Noto Sans CJK TC", size=12, bold=True)

    ws["A6"] = "訂單日期\n訂單交期"
    ws["A6"].font = Font(name="Noto Sans CJK TC", size=10, bold=True)
    ws["A6"].alignment = center
    merge(ws, "B6:D6", "", center)
    ws["E6"] = "類型"
    ws["E6"].font = Font(name="Noto Sans CJK TC", size=10, bold=True)
    ws["E6"].alignment = center
    merge(ws, "F6:I6", "", center)
    for row in range(1, 10):
        ws.cell(6, row).fill = blue_fill

    merge(ws, "A7:I7", "客戶資料", left).font = Font(name="Noto Sans CJK TC", size=10, bold=True)
    for col in range(1, 10): ws.cell(7, col).fill = section_fill
    labels = [(8, "客戶名稱", "統一編號"), (9, "聯絡人", "Email"), (10, "公司地址", "電話/手機")]
    for row, left_label, right_label in labels:
        ws.cell(row, 1).value = left_label
        merge(ws, f"B{row}:D{row}", "", left)
        ws.cell(row, 5).value = right_label
        merge(ws, f"F{row}:I{row}", "", left)

    merge(ws, "A11:I11", "請款內容（NTD)", left).font = Font(name="Noto Sans CJK TC", size=10, bold=True)
    for col in range(1, 10): ws.cell(11, col).fill = section_fill
    headers = [("A12", "貨號"), ("F12", "建議售價"), ("G12", "經銷價"), ("H12", "數量"), ("I12", "總價（未稅）")]
    merge(ws, "B12:E12", "品項名稱", center)
    for ref, value in headers:
        ws[ref] = value
        ws[ref].alignment = center
    for col in range(1, 10): ws.cell(12, col).font = Font(name="Noto Sans CJK TC", size=10)
    for row in range(BASE_ITEM_START, BASE_ITEM_END + 1):
        merge(ws, f"B{row}:E{row}", "", left)
        for col in (1, 6, 7, 8, 9):
            ws.cell(row, col).alignment = center if col != 2 else left

    merge(ws, "A28:I28", "付款資訊", left).font = Font(name="Noto Sans CJK TC", size=10, bold=True)
    for col in range(1, 10): ws.cell(28, col).fill = section_fill
    ws["A29"] = "費用"; merge(ws, "B29:C29", 0, center)
    ws["D29"] = "營業稅（5%)"; merge(ws, "E29:F29", 0, center)
    ws["G29"] = "運費"; merge(ws, "H29:I29", 0, center)
    ws["A30"] = "請款總金額"; merge(ws, "B30:I30", "NT$0", center).font = Font(name="Noto Sans CJK TC", size=11, bold=True)
    ws["A31"] = "支付方式"; merge(ws, "B31:D31", "匯款", center)
    ws["E31"] = "匯款日期"; merge(ws, "F31:I31", "", center)
    merge(ws, "A32:I32", "注意事項", left).font = Font(name="Noto Sans CJK TC", size=10, bold=True)
    for col in range(1, 10): ws.cell(32, col).fill = section_fill
    ws["A33"] = "甲方"; merge(ws, "B33:D33", "奈文良多有限公司", center)
    ws["E33"] = "乙方"; merge(ws, "F33:I33", "", center)
    ws["A34"] = "帳戶資訊"; merge(ws, "B34:D34", "中國信託（822) 文心分行\n帳號：473541331959", center)
    merge(ws, "E34:I34", "1.此內容為商業機密,雙方有權保密,不得向第三方洩漏報價內容。\n2.收款後於月底前寄出發票", left).font = Font(name="Noto Sans CJK TC", size=10, color="FF0000")
    merge(ws, "A35:D35", "客戶/經銷", center); merge(ws, "E35:G35", "奈文良多有限公司", center); merge(ws, "H35:I35", "業務人員", center)
    ws["A36"] = "負責人/公司\n受權簽章"; ws["A36"].alignment = left
    merge(ws, "B36:D36", "", center); merge(ws, "E36:G36", "", center); merge(ws, "H36:I36", "TING", center).font = Font(name="Noto Sans CJK TC", size=14)
    merge(ws, "A37:I37", "1.請用印公司大小章、發票章\n2.簽名請用中文正楷\n3.簽署後即視為同意上述所有約定", left)

    for col in range(1, 10):
        ws.cell(2, col).border = Border(top=outer_side, left=ws.cell(2, col).border.left, right=ws.cell(2, col).border.right, bottom=ws.cell(2, col).border.bottom)
        ws.cell(37, col).border = Border(bottom=outer_side, left=ws.cell(37, col).border.left, right=ws.cell(37, col).border.right, top=ws.cell(37, col).border.top)
    for row in range(2, 38):
        ws.cell(row, 1).border = Border(left=outer_side, right=ws.cell(row, 1).border.right, top=ws.cell(row, 1).border.top, bottom=ws.cell(row, 1).border.bottom)
        ws.cell(row, 9).border = Border(right=outer_side, left=ws.cell(row, 9).border.left, top=ws.cell(row, 9).border.top, bottom=ws.cell(row, 9).border.bottom)
    ws.freeze_panes = None
    ws.print_area = "A2:I37"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.25; ws.page_margins.right = 0.25; ws.page_margins.top = 0.35; ws.page_margins.bottom = 0.35
    return wb


def copy_item_row(ws, source_row: int, target_row: int) -> None:
    ws.row_dimensions[target_row].height = ws.row_dimensions[source_row].height
    for col in range(1, 10):
        src = ws.cell(source_row, col)
        dst = ws.cell(target_row, col)
        dst._style = copy.copy(src._style)
        dst.font = copy.copy(src.font)
        dst.fill = copy.copy(src.fill)
        dst.border = copy.copy(src.border)
        dst.alignment = copy.copy(src.alignment)
        dst.protection = copy.copy(src.protection)
        dst.number_format = src.number_format
    ws.merge_cells(start_row=target_row, start_column=2, end_row=target_row, end_column=5)


def insert_extra_item_rows(ws, count: int):
    if count <= 0:
        return
    shifted_merges = []
    for merged in list(ws.merged_cells.ranges):
        if merged.min_row > BASE_ITEM_END:
            shifted_merges.append((merged.min_row + count, merged.min_col, merged.max_row + count, merged.max_col))
            ws.unmerge_cells(str(merged))
    ws.insert_rows(BASE_ITEM_END + 1, amount=count)
    for row in range(BASE_ITEM_END + 1, BASE_ITEM_END + 1 + count):
        copy_item_row(ws, BASE_ITEM_END, row)
    for min_row, min_col, max_row, max_col in shifted_merges:
        ws.merge_cells(start_row=min_row, start_column=min_col, end_row=max_row, end_column=max_col)


def money(value):
    return round(float(value or 0), 2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template")
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    payload = json.loads(Path(args.data).read_text(encoding="utf-8"))
    template = Path(args.template) if args.template else None
    wb = load_workbook(template) if template and template.exists() else build_fallback_template()
    ws = wb["範本"] if "範本" in wb.sheetnames else wb[wb.sheetnames[0]]
    ws.title = payload["statementNo"][:31]

    items = payload.get("items", [])
    extra_rows = max(0, len(items) - (BASE_ITEM_END - BASE_ITEM_START + 1))
    insert_extra_item_rows(ws, extra_rows)
    last_template_item_row = BASE_ITEM_END + extra_rows
    payment_row = BASE_PAYMENT_ROW + extra_rows
    total_row = payment_row + 1
    party_row = payment_row + 4

    ws["B6"] = f'{payload["issuedAt"]}\n{payload["periodStart"]} ~ {payload["periodEnd"]}'
    source_label = "經銷寄賣" if payload["sourceType"] == "CONSIGNMENT" else "經銷買斷"
    discount = money(payload["settlementRate"]) * 10
    ws["F6"] = f"{source_label}{discount:g}折稅外加"
    ws["B8"] = payload.get("companyName") or payload.get("channelName") or ""
    ws["F8"] = payload.get("taxId") or ""
    ws["B9"] = payload.get("contactName") or ""
    ws["F9"] = payload.get("contactEmail") or ""
    ws["B10"] = payload.get("billingAddress") or ""
    ws["F10"] = payload.get("contactPhone") or ""

    for row in range(BASE_ITEM_START, last_template_item_row + 1):
        for col in (1, 2, 6, 7, 8, 9):
            ws.cell(row, col).value = None

    for index, item in enumerate(items):
        row = BASE_ITEM_START + index
        ws.cell(row, 1).value = item["sku"]
        name = item["productName"]
        if item.get("size") and item["size"] not in name:
            name = f'{name} {item["size"]}'
        ws.cell(row, 2).value = name
        ws.cell(row, 6).value = money(item["listPrice"])
        ws.cell(row, 7).value = money(item["settlementPrice"])
        ws.cell(row, 8).value = int(item["quantity"])
        ws.cell(row, 9).value = f"=G{row}*H{row}"

    ws.cell(payment_row, 2).value = f"=SUM(I{BASE_ITEM_START}:I{last_template_item_row})"
    tax_percent = money(payload["taxRate"]) * 100
    ws.cell(payment_row, 4).value = f"營業稅（{tax_percent:g}%)"
    ws.cell(payment_row, 5).value = f"=B{payment_row}*{money(payload['taxRate'])}"
    ws.cell(payment_row, 8).value = money(payload.get("shippingFee"))
    ws.cell(total_row, 2).value = f"=B{payment_row}+E{payment_row}+H{payment_row}"
    ws.cell(party_row, 6).value = payload.get("companyName") or payload.get("channelName") or ""
    ws.print_area = f"A2:I{37 + extra_rows}"

    try:
        wb.calculation.fullCalcOnLoad = True
        wb.calculation.forceFullCalc = True
        wb.calculation.calcMode = "auto"
    except Exception:
        pass

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)


if __name__ == "__main__":
    main()
