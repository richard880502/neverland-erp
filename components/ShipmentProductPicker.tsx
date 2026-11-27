import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Minus, Package, Plus, Search, X } from "lucide-react";

export type ShipmentKind = "CONSIGNMENT" | "BUYOUT";
export type ShipmentProduct = { id: string; sku: string; name: string; size: string | null; listPrice: number | null; warehouse: number };
export type ShipmentSelection = { productId: string; quantity: number };
type ShipmentCopySource = { id: string; label: string; lines: ShipmentSelection[] };

type Props = {
  channel: { name: string; type: string; settlementRate: number | null };
  initialKind: ShipmentKind;
  initialLines: ShipmentSelection[];
  products: ShipmentProduct[];
  copySources: ShipmentCopySource[];
  getTradePrice: (product: ShipmentProduct, kind: ShipmentKind) => number | null;
  onApply: (kind: ShipmentKind, lines: ShipmentSelection[]) => void;
  onDismiss: () => void;
};

const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "F"];
const sizeCollator = new Intl.Collator("zh-TW", { numeric: true, sensitivity: "base" });
const currency = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });
const percentage = new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 2 });
const maxLines = 100;
const maxQuantity = 1_000_000;

function sizeRank(size: string | null) {
  const rank = sizeOrder.indexOf(size?.trim().toUpperCase() ?? "");
  return rank === -1 ? sizeOrder.length : rank;
}

export function ShipmentProductPicker({ channel, initialKind, initialLines, products, copySources, getTradePrice, onApply, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const catalogScroll = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState(initialKind);
  const [quantities, setQuantities] = useState(() => new Map(initialLines.map(({ productId, quantity }) => [productId, quantity])));
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    heading.current?.focus();
  }, []);

  const catalog = useMemo(() => {
    const groups = new Map<string, ShipmentProduct[]>();
    for (const product of products) {
      const group = groups.get(product.name) ?? [];
      group.push(product);
      groups.set(product.name, group);
    }
    return [...groups].map(([name, items]) => ({ name, items: items.sort((a, b) => (
      sizeRank(a.size) - sizeRank(b.size) || sizeCollator.compare(a.size ?? "", b.size ?? "") || sizeCollator.compare(a.sku, b.sku)
    )) }));
  }, [products]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = catalog.flatMap(({ name, items }) => {
    const visibleItems = items.filter((product) => {
      const text = `${product.name} ${product.sku} ${product.size ?? ""}`.toLowerCase();
      return (!selectedOnly || quantities.has(product.id)) && terms.every((term) => text.includes(term));
    });
    return visibleItems.length ? [{ name, items: visibleItems }] : [];
  });

  const totalQuantity = [...quantities.values()].reduce((total, quantity) => total + quantity, 0);
  const selectedProducts = products.filter((product) => quantities.has(product.id));
  const totalPrice = selectedProducts.reduce((total, product) => total + (getTradePrice(product, kind) ?? 0) * (quantities.get(product.id) ?? 0), 0);
  const hasMissingPrice = selectedProducts.some((product) => product.listPrice == null || getTradePrice(product, kind) == null);
  const missingRate = kind === "CONSIGNMENT" && !channel.settlementRate;
  const canApply = quantities.size > 0 && quantities.size <= maxLines && !missingRate && !hasMissingPrice;

  function changeQuantity(productId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > maxQuantity) return;
    setQuantities((current) => {
      if (quantity > 0 && !current.has(productId) && current.size >= maxLines) return current;
      const next = new Map(current);
      if (quantity === 0) next.delete(productId);
      else next.set(productId, quantity);
      return next;
    });
  }

  function copyLines() {
    const source = copySources.find((item) => item.id === sourceId);
    if (!source) return;
    const available = new Set(products.filter((product) => product.listPrice != null).map((product) => product.id));
    const lines = source.lines.filter((line) => available.has(line.productId));
    const skipped = source.lines.length - lines.length;
    if (!lines.length) {
      setCopyMessage("來源品項已停用或未設定售價，沒有可帶入的商品。");
      return;
    }
    const next = new Map(quantities);
    for (const { productId, quantity } of lines) next.set(productId, quantity);
    if (next.size > maxLines) {
      setCopyMessage(`帶入後會超過 ${maxLines} 個 SKU，請先減少目前已選的品項。`);
      return;
    }
    setQuantities(next);
    setQuery("");
    setSelectedOnly(true);
    catalogScroll.current?.scrollTo({ top: 0 });
    setCopyMessage(`已帶入 ${lines.length} 個 SKU${skipped ? `，略過 ${skipped} 個已停用或未設定售價的品項` : ""}。`);
  }

  return (
    <dialog ref={dialog} className="shipment-picker" aria-labelledby="shipment-picker-title" onClose={onDismiss}>
      <div className="shipment-picker-layout">
        <header className="shipment-picker-header">
          <div><h2 id="shipment-picker-title" ref={heading} tabIndex={-1}>選擇出貨商品</h2><p>{channel.name}</p></div>
          <button className="shipment-picker-icon" type="button" aria-label="關閉商品選擇" onClick={() => dialog.current?.close()}><X size={20} /></button>
        </header>

        <div className="shipment-picker-controls">
          <fieldset className="shipment-deal-options">
            <legend>交易方式 <span>套用整張出貨單</span></legend>
            {channel.type === "CONSIGNMENT" && <label className="shipment-deal-option">
              <input type="radio" name="shipment-deal" checked={kind === "CONSIGNMENT"} onChange={() => setKind("CONSIGNMENT")} />
              <span><strong>寄賣</strong><small>{channel.settlementRate ? `售價 ${percentage.format(channel.settlementRate)}` : "通路尚未設定比例"}</small></span>
            </label>}
            <label className="shipment-deal-option">
              <input type="radio" name="shipment-deal" checked={kind === "BUYOUT"} onChange={() => setKind("BUYOUT")} />
              <span><strong>首批買斷</strong><small>售價 50%</small></span>
            </label>
          </fieldset>

          <div className="shipment-picker-toolbar">
            <label className="shipment-picker-search">
              <Search size={17} aria-hidden="true" />
              <input type="search" aria-label="搜尋商品" placeholder="搜尋品名或 SKU" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button type="button" className="shipment-picker-selected" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(!selectedOnly)}><Check size={15} aria-hidden="true" />只看已選 <strong>{quantities.size}</strong></button>
          </div>
          {copySources.length > 0 && <details className="shipment-picker-copy">
            <summary><Copy size={14} aria-hidden="true" />帶入既有出貨單</summary>
            <div className="shipment-picker-copy-fields">
              <select aria-label="來源出貨單" className="select" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setCopyMessage(""); }}>
                <option value="">選擇來源出貨單</option>
                {copySources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
              </select>
              <button type="button" className="btn btn-secondary" disabled={!sourceId} onClick={copyLines}>帶入品項</button>
            </div>
            <p>同 SKU 更新為來源數量，其他已選品項保留。</p>
            <div className="shipment-picker-copy-message" aria-live="polite">{copyMessage}</div>
          </details>}
        </div>

        <div className="shipment-picker-catalog" ref={catalogScroll}>
          {groups.length ? groups.map(({ name, items }) => (
            <section className="shipment-picker-group" key={name}>
              <h3>{name}</h3>
              <div className="shipment-picker-variants">
                {items.map((product) => {
                  const quantity = quantities.get(product.id) ?? 0;
                  const price = getTradePrice(product, kind);
                  const unavailable = product.listPrice == null;
                  const atLimit = quantity === 0 && quantities.size >= maxLines;
                  return (
                    <div className="shipment-picker-variant" data-selected={quantity > 0} key={product.id}>
                      <div className="shipment-picker-variant-heading"><strong>{product.size || "單一尺寸"}</strong><span className="mono">{product.sku}</span></div>
                      <div className="shipment-picker-variant-details"><span className={quantity > product.warehouse ? "shipment-picker-warning" : undefined}>{quantity > product.warehouse ? "庫存不足 · " : ""}總倉 {product.warehouse}</span><strong>{unavailable ? "未設定售價" : price == null ? "—" : `NT$ ${currency.format(price)}`}</strong></div>
                      <div className="shipment-picker-stepper">
                        <button type="button" aria-label={`減少 ${product.sku} 數量`} disabled={quantity === 0} onClick={() => changeQuantity(product.id, quantity - 1)}><Minus size={16} /></button>
                        <input type="number" inputMode="numeric" aria-label={`${product.sku} 數量`} min={0} max={maxQuantity} step={1} placeholder="0" value={quantity || ""} disabled={atLimit || (unavailable && quantity === 0)} onChange={(event) => changeQuantity(product.id, Number(event.target.value))} />
                        <button type="button" aria-label={`增加 ${product.sku} 數量`} disabled={unavailable || atLimit || quantity >= maxQuantity} onClick={() => changeQuantity(product.id, quantity + 1)}><Plus size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )) : <div className="shipment-picker-empty"><Package size={23} aria-hidden="true" /><strong>{selectedOnly && !quantities.size ? "尚未選擇商品" : "找不到符合的商品"}</strong></div>}
        </div>

        <footer className="shipment-picker-footer">
          <div className="shipment-picker-total" role="status">
            <span>{quantities.size} 個 SKU · {totalQuantity} 件</span>
            <strong>{hasMissingPrice || missingRate ? "—" : `NT$ ${currency.format(totalPrice)}`}</strong>
            {quantities.size >= maxLines && <small>每張出貨單最多 {maxLines} 個 SKU</small>}
          </div>
          <div className="shipment-picker-actions">
            <button className="btn btn-secondary" type="button" onClick={() => dialog.current?.close()}>取消</button>
            <button className="btn btn-primary" type="button" disabled={!canApply} onClick={() => {
              onApply(kind, [...quantities].map(([productId, quantity]) => ({ productId, quantity })));
              dialog.current?.close();
            }}><Check size={16} aria-hidden="true" />套用到草稿</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
