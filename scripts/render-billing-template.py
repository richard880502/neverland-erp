#!/usr/bin/env python3
import argparse
import json
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue

BASE_ITEM_START = 13  # 1-based Excel row
BASE_ITEM_END = 27    # supplied template has 15 item rows
BASE_PAYMENT_ROW = 29
BASE_PRINT_END = 37
XLSX_FILTER = "Calc MS Excel 2007 XML"
PDF_FILTER = "calc_pdf_Export"


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def file_url(path: Path) -> str:
    return uno.systemPathToFileUrl(str(path.resolve()))


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_office(profile_dir: Path):
    port = find_free_port()
    accept = f"socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
    command = [
        "soffice",
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--nolockcheck",
        "--nofirststartwizard",
        f"-env:UserInstallation={file_url(profile_dir)}",
        f"--accept={accept}",
    ]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

    local_ctx = uno.getComponentContext()
    resolver = local_ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_ctx
    )
    last_error = None
    for _ in range(80):
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"LibreOffice 啟動失敗: {stderr.strip()}")
        try:
            ctx = resolver.resolve(
                f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
            )
            return process, ctx
        except Exception as exc:
            last_error = exc
            time.sleep(0.1)
    process.terminate()
    raise RuntimeError(f"無法連線 LibreOffice UNO: {last_error}")


def money(value) -> float:
    return round(float(value or 0), 2)


def get_sheet(doc):
    sheets = doc.getSheets()
    if sheets.hasByName("請款單"):
        return sheets.getByName("請款單")
    if sheets.hasByName("範本"):
        return sheets.getByName("範本")
    return sheets.getByIndex(0)


def set_text(sheet, ref: str, value) -> None:
    cell = sheet.getCellRangeByName(ref)
    cell.String = "" if value is None else str(value)


def set_number(sheet, ref: str, value) -> None:
    sheet.getCellRangeByName(ref).Value = float(value or 0)


def set_formula(sheet, ref: str, formula: str) -> None:
    sheet.getCellRangeByName(ref).Formula = formula


def cell_address(sheet, col: int, row: int):
    return sheet.getCellByPosition(col, row).CellAddress


def copy_item_template_rows(sheet, extra_rows: int) -> None:
    if extra_rows <= 0:
        return

    # Insert immediately above the payment/footer block (before Excel row 28).
    # Calc performs the row insertion so merged cells, formulas, print layout,
    # and cell-anchored drawings move together using the same layout engine
    # that later exports the PDF.
    insert_index = BASE_ITEM_END  # UNO is 0-based: 27 == before Excel row 28
    rows = sheet.getRows()
    source_index = BASE_ITEM_END - 1  # Excel row 27
    source_height = rows.getByIndex(source_index).Height
    rows.insertByIndex(insert_index, extra_rows)

    source = sheet.getCellRangeByName(f"A{BASE_ITEM_END}:I{BASE_ITEM_END}").RangeAddress
    for offset in range(extra_rows):
        target_index = insert_index + offset
        sheet.copyRange(cell_address(sheet, 0, target_index), source)
        rows.getByIndex(target_index).Height = source_height


def clear_item_rows(sheet, item_end_row: int) -> None:
    # Only content is cleared. Formatting, merges, widths, heights and drawings
    # remain owned by the original XLSX / LibreOffice.
    for row in range(BASE_ITEM_START, item_end_row + 1):
        for col in ("A", "B", "F", "G", "H", "I"):
            set_text(sheet, f"{col}{row}", "")


def populate_sheet(sheet, payload: dict) -> int:
    items = payload.get("items") or []
    capacity = BASE_ITEM_END - BASE_ITEM_START + 1
    extra_rows = max(0, len(items) - capacity)
    copy_item_template_rows(sheet, extra_rows)

    item_end_row = BASE_ITEM_END + extra_rows
    payment_row = BASE_PAYMENT_ROW + extra_rows
    total_row = payment_row + 1
    party_row = payment_row + 4

    set_text(sheet, "B6", f'{payload["issuedAt"]}\n{payload["periodStart"]} ~ {payload["periodEnd"]}')
    source_label = "經銷寄賣" if payload.get("sourceType") == "CONSIGNMENT" else "經銷買斷"
    discount = money(payload.get("settlementRate")) * 10
    set_text(sheet, "F6", f"{source_label}{discount:g}折稅外加")
    set_text(sheet, "B8", payload.get("companyName") or payload.get("channelName") or "")
    set_text(sheet, "F8", payload.get("taxId") or "")
    set_text(sheet, "B9", payload.get("contactName") or "")
    set_text(sheet, "F9", payload.get("contactEmail") or "")
    set_text(sheet, "B10", payload.get("billingAddress") or "")
    set_text(sheet, "F10", payload.get("contactPhone") or "")

    clear_item_rows(sheet, item_end_row)
    for index, item in enumerate(items):
        row = BASE_ITEM_START + index
        set_text(sheet, f"A{row}", item.get("sku") or "")
        name = item.get("productName") or ""
        size = item.get("size")
        if size and str(size) not in name:
            name = f"{name} {size}"
        set_text(sheet, f"B{row}", name)
        set_number(sheet, f"F{row}", money(item.get("listPrice")))
        set_number(sheet, f"G{row}", money(item.get("settlementPrice")))
        set_number(sheet, f"H{row}", int(item.get("quantity") or 0))
        set_formula(sheet, f"I{row}", f"=G{row}*H{row}")

    set_formula(sheet, f"B{payment_row}", f"=SUM(I{BASE_ITEM_START}:I{item_end_row})")
    tax_rate = money(payload.get("taxRate"))
    set_text(sheet, f"D{payment_row}", f"營業稅（{tax_rate * 100:g}%)")
    set_formula(sheet, f"E{payment_row}", f"=B{payment_row}*{tax_rate}")
    set_number(sheet, f"H{payment_row}", money(payload.get("shippingFee")))
    set_formula(sheet, f"B{total_row}", f"=B{payment_row}+E{payment_row}+H{payment_row}")
    set_text(sheet, f"F{party_row}", payload.get("companyName") or payload.get("channelName") or "")

    # Keep the original page settings; only extend the print range when item
    # rows were inserted. This avoids programmatically rebuilding page layout.
    print_range = sheet.getCellRangeByName(f"A2:I{BASE_PRINT_END + extra_rows}").RangeAddress
    sheet.setPrintAreas((print_range,))
    return extra_rows


def save_xlsx(doc, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.storeAsURL(
        file_url(output),
        (prop("FilterName", XLSX_FILTER), prop("Overwrite", True)),
    )


def save_pdf(doc, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.storeToURL(
        file_url(output),
        (prop("FilterName", PDF_FILTER), prop("Overwrite", True)),
    )


def render(template: Path, payload: dict, output: Path, format_: str) -> None:
    if not template.is_file():
        raise FileNotFoundError(f"找不到請款 XLSX 模板: {template}")
    if template.suffix.lower() != ".xlsx":
        raise RuntimeError("請款模板必須是 .xlsx")

    with tempfile.TemporaryDirectory(prefix="neverland-lo-") as temp_dir:
        workdir = Path(temp_dir)
        profile = workdir / "profile"
        # Opening a working copy guarantees the checked-in master template is
        # never modified in-place, even if LibreOffice decides to create locks.
        working_template = workdir / "template.xlsx"
        shutil.copy2(template, working_template)

        process, ctx = start_office(profile)
        doc = None
        try:
            smgr = ctx.ServiceManager
            desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
            doc = desktop.loadComponentFromURL(
                file_url(working_template),
                "_blank",
                0,
                (prop("Hidden", True), prop("ReadOnly", False), prop("UpdateDocMode", 3)),
            )
            if doc is None:
                raise RuntimeError("LibreOffice 無法開啟請款 XLSX 模板")
            if not doc.supportsService("com.sun.star.sheet.SpreadsheetDocument"):
                raise RuntimeError("請款模板不是 Calc 試算表")

            sheet = get_sheet(doc)
            populate_sheet(sheet, payload)
            try:
                doc.enableAutomaticCalculation(True)
            except Exception:
                pass
            doc.calculateAll()

            if format_ == "xlsx":
                save_xlsx(doc, output)
            else:
                # Persist the filled document as XLSX first, then export PDF
                # from the same live Calc document. This mirrors the stable
                # single-renderer behavior we want from Google Sheets.
                filled_xlsx = output.with_suffix(".xlsx")
                save_xlsx(doc, filled_xlsx)
                doc.calculateAll()
                save_pdf(doc, output)
        finally:
            if doc is not None:
                try:
                    doc.close(True)
                except Exception:
                    try:
                        doc.dispose()
                    except Exception:
                        pass
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--format", choices=("xlsx", "pdf"), required=True)
    args = parser.parse_args()

    payload = json.loads(Path(args.data).read_text(encoding="utf-8"))
    render(Path(args.template), payload, Path(args.output), args.format)


if __name__ == "__main__":
    main()
