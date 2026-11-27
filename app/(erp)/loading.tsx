export default function ErpLoading() {
  return (
    <section className="erp-loading" role="status">
      <strong>正在載入頁面…</strong>
      <div className="erp-loading-preview" aria-hidden="true">
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}
