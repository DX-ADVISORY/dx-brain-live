const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = { console, setTimeout, clearTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "cloud-status.js"), "utf8"), context);
const api = context.DXCloudStatus;
if (!api) {
  console.error("DXCloudStatus was not exported");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function baseContract() {
  return {
    schema: "dx-cloud-contract/v1",
    execution: { mode: "local-exercise", scheduled_run_completed: false },
    clocks: {
      browser_session: { recorded_by_cloud: false, animation_is_processing: false },
      cloud_heartbeat: {
        recorded_at_utc: "2026-11-07T01:41:00+00:00",
        recorded_at_ict: "2026-11-07T08:41:00+07:00",
        worker_ran: true,
        means_ingestion: false,
        means_publish: false,
        means_snapshot_refresh: false,
        stale_after_seconds: 8 * 3600,
        scheduled_run_completed: false,
        schedule_ict: ["07:20", "13:20", "17:20", "01:20 (ngày kế)"]
      },
      source_snapshot: {
        generated_at_ict: "2026-11-06T20:00:00+07:00",
        parse_ok: true,
        age_seconds: 100,
        stale: false,
        stale_after_seconds: 26 * 3600,
        anomaly: null,
        counts_are_live: false
      },
      ingestion: {
        complete: false,
        attempted: false,
        reason_code: "no_approved_public_source",
        receipt_count: 0,
        last_verified_at: null,
        conversation_access: "not_inferred",
        channels_not_read: ["chatgpt", "claude", "grok"]
      }
    },
    laptop_catchup: {
      local_ingestion_pending: true,
      snapshot_refresh_pending: false,
      on_reconnect: ["Giữ task DX_BrainMap_v6_Refresh chạy hằng ngày lúc 20:00 UTC+7.", "<img src=x onerror=alert(1)>"]
    }
  };
}

const now = Date.parse("2026-11-07T01:41:00Z");
const fresh = api.classify(baseContract(), now);
assert(fresh.heartbeat.state === "heartbeat-only", "fresh heartbeat state " + fresh.heartbeat.state);
assert(fresh.snapshot.state === "observed", "fresh snapshot should stay observed");
assert(fresh.ingestion.state === "pending", "empty ingestion is pending");
assert(fresh.catchup.state === "pending", "laptop catch-up stays pending");

const aged = baseContract();
const later = Date.parse("2026-11-08T02:00:00Z");
const agedView = api.classify(aged, later);
assert(agedView.snapshot.state === "stale", "live snapshot age overrides a baked fresh flag");
assert(agedView.heartbeat.state === "stale", "heartbeat older than eight hours is stale");

const lying = baseContract();
lying.clocks.cloud_heartbeat.means_ingestion = true;
const lyingHtml = api.renderPanel(lying, now);
assert(lyingHtml.includes('data-clock="cloud-heartbeat" data-state="error"'), "lying heartbeat is rejected");
assert(!lyingHtml.includes('data-state="heartbeat-only"'), "lying heartbeat must not look like a normal beat");

const missing = api.renderPanel(null, now);
assert(missing.includes("Chưa đọc được hợp đồng"), missing);
assert(!missing.includes("08:41"), "missing contract must not borrow a heartbeat time");
assert(!missing.includes("20:00:00"), "missing contract must not borrow the snapshot time");

const shown = api.renderPanel(baseContract(), now);
assert(shown.includes('data-clock="browser-session"'), shown);
assert(shown.includes('data-clock="cloud-heartbeat" data-state="heartbeat-only"'), shown);
assert(shown.includes('data-clock="source-snapshot"'), shown);
assert(shown.includes('data-clock="ingestion" data-state="pending"'), shown);
assert(shown.includes("Chưa chạy · 0 biên nhận · no_approved_public_source"), shown);
assert(shown.includes("Để máy nguồn: ChatGPT, Claude, Grok."), shown);
assert(shown.includes("local-exercise"), shown);
assert(shown.includes("&lt;img src=x onerror=alert(1)&gt;"), "catch-up text is escaped");
assert(!shown.includes("<img src=x"), "raw markup from the contract must not be inserted");
assert(shown.includes("<details><summary>Việc khi máy nguồn mở lại</summary>"), "reconnect steps stay collapsed");
assert(!shown.includes("<details open"), "reconnect list does not force the row open");
assert(shown.includes("data-means-ingestion=\"false\""), shown);

const verified = baseContract();
verified.clocks.ingestion.complete = true;
verified.clocks.ingestion.attempted = true;
verified.clocks.ingestion.receipt_count = 1;
verified.clocks.ingestion.last_verified_at = "2026-11-07T01:00:00+00:00";
assert(api.classify(verified, now).ingestion.state === "ok", "a real receipt can be ok");
assert(api.renderPanel(verified, now).includes("Đã xác minh 1 biên nhận"), "ok copy is reserved for receipts");

function element() {
  return {
    nodeType: 1,
    style: {},
    dataset: {},
    attrs: {},
    childNodes: [],
    textContent: "",
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(child) { this.childNodes.push(child); },
    insertAdjacentElement(_where, child) { this.next = child; },
    querySelector(selector) { return selector === "i" ? this.dot : null; }
  };
}

const text = { nodeType: 3, nodeValue: "đang chạy · " };
const dot = { style: {} };
const pill = element();
pill.childNodes = [dot, text];
pill.dot = dot;
const snapat = { textContent: "Ảnh dữ liệu: 06/11/2026 20:00 (UTC+7)" };
const heading = { textContent: "Nhật ký · tail -f brain.log" };
const schedule = element();
const kpi = { textContent: "43" };
const header = element();
const created = [];
const doc = {
  head: { appendChild() {} },
  body: { insertBefore() {}, firstChild: null },
  readyState: "complete",
  getElementById(id) {
    if (id === "snapat") return snapat;
    if (id === "sched") return schedule;
    if (id === "kpis") return kpi;
    return null;
  },
  querySelector(selector) {
    if (selector === ".pill") return pill;
    if (selector === "header") return header;
    return null;
  },
  querySelectorAll(selector) {
    return selector === "h3" ? [heading] : [];
  },
  createElement(tag) {
    const node = element();
    node.tag = tag;
    node.innerHTML = "";
    created.push(node);
    return node;
  }
};

const published = JSON.parse(fs.readFileSync(path.join(root, "status", "cloud_contract.json"), "utf8"));
const mounted = [];
function fetchImpl(url) {
  mounted.push(url);
  return Promise.resolve({
    ok: true,
    json() { return Promise.resolve(published); }
  });
}

api.applyStaticLabels(doc);
assert(text.nodeValue.includes("phiên tab"), text.nodeValue);
assert(!text.nodeValue.includes("đang chạy"), text.nodeValue);
assert(dot.style.animation === "none", "pill blink is not a processing light");
assert(pill.dataset.clock === "browser-session", "pill is marked as the browser clock");
assert(heading.textContent === "Nhật ký trong ảnh đã xuất", heading.textContent);
assert(snapat.textContent.includes("mốc xuất bản"), snapat.textContent);
assert(kpi.textContent === "43", "KPI text stays on the snapshot value");

api.mount(doc, { fetch: fetchImpl, now: () => now }).then(function (contract) {
  assert(contract && contract.clocks.ingestion.complete === false, "mounted contract is not ingestion");
  assert(mounted.length === 1 && mounted[0].includes("status/cloud_contract.json"), mounted.join(","));
  assert(header.next && header.next.innerHTML.includes('data-clock="ingestion"'), header.next && header.next.innerHTML);
  assert(header.next.innerHTML.includes("no_approved_public_source"), header.next.innerHTML);
  assert(kpi.textContent === "43", "mount leaves the legal KPI alone");
  console.log("cloud-status tests passed");
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
