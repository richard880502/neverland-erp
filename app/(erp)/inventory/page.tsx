import { InventoryCatalog } from "@/components/InventoryCatalog";
import { getInventoryRows } from "@/lib/data";
import { measureErpLoad } from "@/lib/erp-timing";

export default async function InventoryPage() {
  const rows = await measureErpLoad("inventory.page-data", getInventoryRows);
  const locations = new Map<string, string>();
  for (const row of rows) for (const location of row.locations) locations.set(location.id, location.name);

  return (
    <InventoryCatalog
      rows={rows}
      locations={[...locations].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))}
    />
  );
}
