/* Public status strip. Four clocks stay separate: tab session, cloud heartbeat,
   snapshot age, and ingestion receipts. This file does not change KPI numbers,
   the map, or the logo. */
(function (root) {
  var CHANNELS = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    grok: "Grok",
    x: "X",
    onedrive: "OneDrive",
    gdrive: "Google Drive",
    obsidian: "Obsidian",
    "local-brain": "brain local",
    "laptop-disk": "đĩa máy nguồn"
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function formatIct(iso) {
    if (!iso) return "không có mốc";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "mốc không đọc được";
    var shifted = new Date(date.getTime() + 7 * 3600 * 1000);
    function pad(number) { return String(number).padStart(2, "0"); }
    return pad(shifted.getUTCHours()) + ":" + pad(shifted.getUTCMinutes()) + " " +
      pad(shifted.getUTCDate()) + "/" + pad(shifted.getUTCMonth() + 1) + "/" +
      shifted.getUTCFullYear() + " UTC+7";
  }

  function formatAge(seconds) {
    if (seconds == null || seconds < 0) return "chưa tính được tuổi";
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 48) return Math.floor(hours / 24) + " ngày";
    return hours + " giờ " + minutes + " phút";
  }

  function ageOf(iso, nowMs) {
    var date = new Date(iso);
    if (!iso || isNaN(date.getTime())) return null;
    return Math.floor((nowMs - date.getTime()) / 1000);
  }

  function classify(contract, nowMs) {
    if (!contract || !contract.clocks) {
      return {
        browser: { state: "session" },
        heartbeat: { state: "error" },
        snapshot: { state: "error" },
        ingestion: { state: "error" },
        catchup: { state: "error" },
        contractMissing: true
      };
    }
    var heartbeat = contract.clocks.cloud_heartbeat || {};
    var snapshot = contract.clocks.source_snapshot || {};
    var ingestion = contract.clocks.ingestion || {};
    var catchup = contract.laptop_catchup || {};
    var heartbeatAge = ageOf(heartbeat.recorded_at_utc, nowMs);
    var heartbeatState = "error";
    if (heartbeat.means_ingestion === false && heartbeat.means_publish === false && heartbeat.worker_ran === true) {
      var limit = heartbeat.stale_after_seconds || 28800;
      if (heartbeatAge != null && heartbeatAge < -300) heartbeatState = "error";
      else if (heartbeatAge != null && heartbeatAge > limit) heartbeatState = "stale";
      else heartbeatState = "heartbeat-only";
    }
    var snapshotAge = ageOf(snapshot.generated_at_ict, nowMs);
    if (snapshotAge == null) snapshotAge = snapshot.age_seconds;
    var snapshotState = "error";
    if (snapshot.parse_ok === true && !snapshot.anomaly) {
      var snapLimit = snapshot.stale_after_seconds || 93600;
      if (snapshotAge != null && snapshotAge < -300) snapshotState = "error";
      else snapshotState = snapshotAge != null && snapshotAge >= snapLimit ? "stale" : "observed";
    }
    var ingestionState = "pending";
    if (ingestion.complete === true && ingestion.receipt_count > 0 && ingestion.last_verified_at) {
      ingestionState = "ok";
    } else if (ingestion.attempted === true) {
      ingestionState = "error";
    }
    return {
      browser: { state: "session" },
      heartbeat: { state: heartbeatState, ageSeconds: heartbeatAge },
      snapshot: { state: snapshotState, ageSeconds: snapshotAge },
      ingestion: { state: ingestionState },
      catchup: { state: catchup.local_ingestion_pending ? "pending" : "observed" },
      contractMissing: false
    };
  }

  function channelLine(codes) {
    var names = (codes || []).map(function (code) { return esc(CHANNELS[code] || code); });
    if (!names.length) return "";
    return "Để máy nguồn: " + names.join(", ") + ".";
  }

  function renderPanel(contract, nowMs) {
    var view = classify(contract, nowMs);
    if (view.contractMissing) {
      return [
        '<h2>Bốn mốc thời gian</h2>',
        card("browser-session", "session", "Phiên trình duyệt", "Đếm trên tab này", "Đồng hồ cạnh tiêu đề bắt đầu khi mở tab. Hoạt ảnh 3D chạy cùng tab."),
        card("cloud-heartbeat", "error", "Nhịp cloud", "Chưa đọc được hợp đồng", "Chưa đọc được status/cloud_contract.json. Giao diện không điền giờ nhịp."),
        card("source-snapshot", "error", "Ảnh nguồn", "Chưa đối chiếu", "Tuổi ảnh nguồn nằm trong hợp đồng cloud."),
        card("ingestion", "error", "Biên nhận thu thập", "Chưa đọc được", "Không có biên nhận mới để hiển thị."),
        card("laptop-catchup", "error", "Bắt kịp máy nguồn", "Chưa đọc được hợp đồng", "Task máy nguồn vẫn là DX_BrainMap_v6_Refresh lúc 20:00 UTC+7.")
      ].join("");
    }
    var heartbeat = contract.clocks.cloud_heartbeat;
    var snapshot = contract.clocks.source_snapshot;
    var ingestion = contract.clocks.ingestion;
    var catchup = contract.laptop_catchup;
    var mode = contract.execution && contract.execution.mode;
    var heartbeatValue = view.heartbeat.state === "error"
      ? "Hợp đồng nhịp không được dùng"
      : "Đã ghi nhịp lúc " + formatIct(heartbeat.recorded_at_utc);
    var heartbeatDetail = view.heartbeat.state === "error"
      ? "Giao diện chỉ nhận nhịp khi means_ingestion và means_publish đều là false."
      : "Mục này ghi mỗi lần worker chạy. Lịch UTC+7: " + (heartbeat.schedule_ict || []).map(esc).join(", ") + ".";
    if (heartbeat.scheduled_run_completed === false) {
      heartbeatDetail += " Cron GitHub chưa có lần chạy schedule trong bản ghi này.";
    }
    if (mode === "local-exercise") {
      heartbeatDetail += " Bản ghi hiện do chạy thử công cụ, mode local-exercise.";
    }
    if (view.heartbeat.state === "stale") {
      heartbeatDetail += " Tuổi nhịp: " + formatAge(view.heartbeat.ageSeconds) + ".";
    }
    var snapshotValue = snapshot.parse_ok
      ? formatIct(snapshot.generated_at_ict) + " · tuổi " + formatAge(view.snapshot.ageSeconds)
      : "Không đọc được mốc ảnh";
    var snapshotDetail = snapshot.parse_ok
      ? "Mốc xuất bản trong ảnh đã gạn. Worker cloud giữ nguyên các số của ảnh."
      : "Ảnh nguồn không có giờ xuất bản đọc được.";
    if (snapshot.anomaly) snapshotDetail += " Bất thường: " + esc(snapshot.anomaly) + ".";
    if (snapshot.stale) snapshotDetail += " Ảnh đã qua ngưỡng " + formatAge(snapshot.stale_after_seconds) + ".";
    var ingestionValue = view.ingestion.state === "ok"
      ? "Đã xác minh " + ingestion.receipt_count + " biên nhận lúc " + formatIct(ingestion.last_verified_at)
      : (ingestion.attempted ? "Chưa hoàn tất" : "Chưa chạy") + " · " + ingestion.receipt_count + " biên nhận · " + (ingestion.reason_code || "không rõ");
    var ingestionDetail = view.ingestion.state === "ok"
      ? "Lần xác minh này có biên nhận của nguồn được duyệt."
      : "Chưa có biên nhận thu thập hoàn tất.";
    if (ingestion.conversation_access === "not_inferred") {
      ingestionDetail += " Hội thoại ChatGPT, Claude và Grok không có mặt trong biên nhận cloud.";
    }
    ingestionDetail += " " + channelLine(ingestion.channels_not_read);
    var steps = (catchup.on_reconnect || []).map(function (step) {
      return "<li>" + esc(step) + "</li>";
    }).join("");
    var catchupValue = catchup.snapshot_refresh_pending
      ? "Ảnh nguồn cần máy nguồn xuất lại"
      : "Ảnh nguồn còn trong hạn xuất bản";
    return [
      "<h2>Bốn mốc thời gian</h2>",
      card("browser-session", view.browser.state, "Phiên trình duyệt", "Đếm trên tab này", "Đồng hồ cạnh tiêu đề bắt đầu khi mở tab. Hoạt ảnh 3D chạy cùng tab."),
      card("cloud-heartbeat", view.heartbeat.state, "Nhịp cloud", heartbeatValue, heartbeatDetail, ' data-means-ingestion="' + esc(heartbeat.means_ingestion) + '"'),
      card("source-snapshot", view.snapshot.state, "Ảnh nguồn", snapshotValue, snapshotDetail),
      card("ingestion", view.ingestion.state, "Biên nhận thu thập", ingestionValue, ingestionDetail),
      card("laptop-catchup", view.catchup.state, "Bắt kịp máy nguồn", catchupValue, "Máy nguồn giữ task DX_BrainMap_v6_Refresh lúc 20:00 UTC+7. Quét luật hằng tháng vẫn ở máy nguồn.<ol>" + steps + "</ol>"),
      '<p class="note">Các số trên thẻ là số trong ảnh đã xuất.</p>'
    ].join("");
  }

  function card(clock, state, title, value, detail, extra) {
    return '<article data-clock="' + clock + '" data-state="' + state + '"' + (extra || "") + ">" +
      '<div class="k">' + esc(title) + "</div>" +
      '<div class="v">' + esc(value) + "</div>" +
      '<div class="s">' + detail + "</div></article>";
  }

  function ensureStyle(doc) {
    if (doc.getElementById("dx-cloud-style")) return;
    var style = doc.createElement("style");
    style.id = "dx-cloud-style";
    style.textContent = [
      "#dx-cloud-status{margin:10px 20px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}",
      "#dx-cloud-status h2{grid-column:1/-1;margin:0;font-size:12px;font-weight:600;letter-spacing:.04em;color:#7d8ba1}",
      "#dx-cloud-status article{background:#0d1420;border:1px solid #1c2738;border-radius:10px;padding:8px 10px}",
      "#dx-cloud-status .k{font-size:11px;color:#7d8ba1}",
      "#dx-cloud-status .v{font-size:13px;margin-top:3px;line-height:1.35}",
      "#dx-cloud-status .s{font-size:11px;color:#9aabbf;margin-top:4px;line-height:1.4}",
      "#dx-cloud-status ol{margin:6px 0 0;padding-left:16px}",
      "#dx-cloud-status .note{grid-column:1/-1;margin:0;color:#7d8ba1;font-size:11px}",
      '#dx-cloud-status article[data-state="heartbeat-only"]{border-color:#38d9f5}',
      '#dx-cloud-status article[data-state="observed"],#dx-cloud-status article[data-state="session"]{border-color:#1c2738}',
      '#dx-cloud-status article[data-state="pending"],#dx-cloud-status article[data-state="stale"]{border-color:#f5b942}',
      '#dx-cloud-status article[data-state="error"]{border-color:#ff5d73}',
      '#dx-cloud-status article[data-state="ok"]{border-color:#3ee08f}'
    ].join("");
    (doc.head || doc.documentElement).appendChild(style);
  }

  function replaceText(node, pattern, replacement) {
    if (!node || !node.childNodes) return;
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3 && pattern.test(child.nodeValue || "")) {
        child.nodeValue = child.nodeValue.replace(pattern, replacement);
      }
    });
  }

  function applyStaticLabels(doc) {
    var pill = doc.querySelector(".pill");
    if (pill) {
      pill.style.borderColor = "#7d8ba1";
      pill.style.color = "#c5d0de";
      pill.dataset.clock = "browser-session";
      pill.setAttribute("title", "Đếm từ lúc mở tab này.");
      replaceText(pill, /đang chạy/g, "phiên tab");
      var dot = pill.querySelector("i");
      if (dot) dot.style.animation = "none";
    }
    var snapat = doc.getElementById("snapat");
    if (snapat && snapat.textContent.indexOf("mốc xuất bản") < 0) {
      snapat.textContent = snapat.textContent + " · mốc xuất bản của ảnh";
    }
    Array.prototype.forEach.call(doc.querySelectorAll("h3"), function (heading) {
      if (/Nhật ký/.test(heading.textContent || "") && /tail -f/.test(heading.textContent || "")) {
        heading.textContent = "Nhật ký trong ảnh đã xuất";
      }
    });
    var schedule = doc.getElementById("sched");
    if (schedule && !schedule.dataset.cloudNote) {
      var note = doc.createElement("div");
      note.textContent = "Lịch phía trên nằm trong ảnh máy nguồn. Lịch worker cloud nằm ở thanh bốn mốc.";
      schedule.appendChild(note);
      schedule.dataset.cloudNote = "1";
    }
  }

  function mount(doc, options) {
    options = options || {};
    var fetchImpl = options.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    var nowFn = options.now || function () { return Date.now(); };
    applyStaticLabels(doc);
    ensureStyle(doc);
    var host = doc.getElementById("dx-cloud-status");
    if (!host) {
      host = doc.createElement("section");
      host.id = "dx-cloud-status";
      host.setAttribute("aria-label", "Bốn mốc thời gian của bộ não");
      var header = doc.querySelector("header");
      if (header && header.insertAdjacentElement) header.insertAdjacentElement("afterend", host);
      else if (doc.body) doc.body.insertBefore(host, doc.body.firstChild);
    }
    function draw(contract) {
      host.innerHTML = renderPanel(contract, nowFn());
    }
    if (!fetchImpl) {
      draw(null);
      return Promise.resolve(null);
    }
    return fetchImpl("status/cloud_contract.json?t=" + nowFn(), { cache: "no-store" }).then(function (response) {
      if (!response || response.ok !== true) throw new Error("status_http");
      return response.json();
    }).then(function (contract) {
      draw(contract);
      return contract;
    }).catch(function () {
      draw(null);
      return null;
    });
  }

  var api = {
    classify: classify,
    renderPanel: renderPanel,
    applyStaticLabels: applyStaticLabels,
    mount: mount,
    formatIct: formatIct
  };
  root.DXCloudStatus = api;

  if (typeof document !== "undefined" && document.querySelector && document.getElementById("snap")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(document); });
    else mount(document);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
