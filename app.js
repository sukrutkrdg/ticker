/* HOLI Treasury Tracker — all logic runs client-side against public endpoints. */
(function () {
  "use strict";

  var CFG = window.HOLI_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var errors = [];

  /* ------------------------------------------------------------------ *
   * fetch helpers
   * ------------------------------------------------------------------ */

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(label + ": timed out")); }, ms);
      promise.then(
        function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); }
      );
    });
  }

  function getJSON(url, label) {
    return withTimeout(
      fetch(url, { headers: { accept: "application/json" }, cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(label + ": HTTP " + r.status);
        return r.json();
      }),
      20000, label
    );
  }

  function rpc(method, params, label) {
    return withTimeout(
      fetch(CFG.chain.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      }).then(function (r) {
        if (!r.ok) throw new Error(label + ": HTTP " + r.status);
        return r.json();
      }).then(function (j) {
        if (j.error) throw new Error(label + ": " + (j.error.message || "rpc error"));
        return j.result;
      }),
      20000, label
    );
  }

  function ethCall(to, data, label) {
    return rpc("eth_call", [{ to: to, data: data }, "latest"], label);
  }

  // Resolve regardless of outcome, recording failures so one dead endpoint
  // cannot blank the whole page.
  function soft(p, label) {
    return p.catch(function (e) {
      errors.push(label + " — " + (e && e.message ? e.message : String(e)));
      return null;
    });
  }

  /* ------------------------------------------------------------------ *
   * formatting
   * ------------------------------------------------------------------ */

  function toUnits(raw, decimals) {
    // raw is a decimal string of an integer; return a JS number of whole units.
    if (raw == null) return 0;
    var s = String(raw).replace(/[^0-9]/g, "");
    if (!s) return 0;
    var d = decimals || 0;
    if (s.length <= d) s = new Array(d - s.length + 2).join("0") + s;
    var whole = s.slice(0, s.length - d) || "0";
    var frac = d ? s.slice(s.length - d) : "";
    return parseFloat(whole + (frac ? "." + frac : ""));
  }

  function usd(n) {
    if (!isFinite(n)) return "—";
    var digits = n !== 0 && Math.abs(n) < 1 ? 6 : 2;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function usdCompactish(n) {
    if (!isFinite(n)) return "—";
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function num(n, max) {
    if (!isFinite(n)) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: max === undefined ? 2 : max });
  }

  function compact(n) {
    if (!isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return num(n, 2);
  }

  function shortAddr(a) {
    if (!a) return "—";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function utcDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toISOString().slice(0, 10) + " " + d.toISOString().slice(11, 16);
  }

  function explorerAddr(a) { return CFG.chain.explorer + "/address/" + a; }
  function explorerTx(h) { return CFG.chain.explorer + "/tx/" + h; }

  /* ------------------------------------------------------------------ *
   * minimal ABI decoding (enough for the three Safe getters)
   * ------------------------------------------------------------------ */

  function words(hex) {
    var h = (hex || "").replace(/^0x/, "");
    var out = [];
    for (var i = 0; i + 64 <= h.length; i += 64) out.push(h.slice(i, i + 64));
    return out;
  }

  function decodeAddressArray(hex) {
    var w = words(hex);
    if (w.length < 2) return [];
    // w[0] = offset (always 0x20 here), w[1] = length
    var len = parseInt(w[1], 16);
    var out = [];
    for (var i = 0; i < len && 2 + i < w.length; i++) {
      out.push("0x" + w[2 + i].slice(24));
    }
    return out;
  }

  function decodeUint(hex) {
    var w = words(hex);
    return w.length ? parseInt(w[0], 16) : NaN;
  }

  function decodeString(hex) {
    var w = words(hex);
    if (w.length < 3) return "";
    var len = parseInt(w[1], 16);
    var body = w.slice(2).join("").slice(0, len * 2);
    var s = "";
    for (var i = 0; i + 2 <= body.length; i += 2) {
      var c = parseInt(body.substr(i, 2), 16);
      if (c) s += String.fromCharCode(c);
    }
    return s;
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  function renderHero(state) {
    var value = state.treasuryUsd;
    $("target-usd").textContent = usdCompactish(CFG.target);

    if (!isFinite(value)) {
      $("tv-usd").textContent = "Unavailable";
      return;
    }

    $("tv-usd").textContent = usdCompactish(value);
    $("tv-usd").classList.remove("skeleton-text");

    var pct = Math.max(0, Math.min(100, (value / CFG.target) * 100));
    $("progress-fill").style.width = pct.toFixed(3) + "%";
    $("progress-track").setAttribute("aria-valuenow", pct.toFixed(1));
    $("pct").textContent = pct.toFixed(2) + "%";
    $("remaining").textContent = usdCompactish(Math.max(0, CFG.target - value));

    // --- projection -------------------------------------------------
    var eta = $("eta-line");
    var tx = state.transfers;
    if (!tx || tx.length < 2 || !isFinite(state.price) || state.price <= 0) {
      eta.textContent = "Projection unavailable — not enough transfer history.";
      return;
    }

    var first = new Date(tx[tx.length - 1].ts).getTime();
    var days = (Date.now() - first) / 86400000;
    var netTokens = state.shyt; // treasury has only ever received; net == balance
    if (days <= 0 || netTokens <= 0) {
      eta.textContent = "Projection unavailable.";
      return;
    }

    var tokensPerDay = netTokens / days;
    var targetTokens = CFG.target / state.price;
    var deficit = targetTokens - netTokens;

    if (deficit <= 0) {
      eta.textContent = "Target reached at current price.";
      return;
    }

    // Accumulating to the target is only possible if the tokens required still
    // exist. Saying "N days" when N tokens exceed total supply would be false.
    if (isFinite(state.totalSupply) && state.totalSupply > 0 && targetTokens > state.totalSupply) {
      eta.textContent = "Accumulation alone cannot reach it at today's price — see below.";
      return;
    }

    var daysLeft = deficit / tokensPerDay;
    if (!isFinite(daysLeft) || daysLeft > 3650) {
      eta.textContent = "At the observed rate, the target is more than 10 years out.";
      return;
    }

    eta.textContent =
      "~" + Math.round(daysLeft).toLocaleString("en-US") +
      " days at the observed rate (" + compact(tokensPerDay) + " SHYT/day, price held flat).";
  }

  function renderPath(state) {
    var flag = $("path-flag");
    flag.hidden = true;
    flag.innerHTML = "";

    if (!isFinite(state.price) || state.price <= 0 || !isFinite(state.shyt) || state.shyt <= 0) {
      $("lever-tokens").textContent = "—";
      $("lever-tokens-sub").textContent = "—";
      $("lever-price").textContent = "—";
      $("lever-price-sub").textContent = "—";
      return;
    }

    // Lever 1: how many SHYT the Safe would need to hold, at today's price.
    var tokensNeeded = CFG.target / state.price;
    $("lever-tokens").textContent = compact(tokensNeeded) + " SHYT";

    var sub1 = compact(tokensNeeded / state.shyt) + "× current holdings";
    if (isFinite(state.totalSupply) && state.totalSupply > 0) {
      sub1 += " · " + num((tokensNeeded / state.totalSupply) * 100, 1) + "% of total supply";
    }
    $("lever-tokens-sub").textContent = sub1;

    // Lever 2: what SHYT would have to be worth, at today's balance.
    var priceNeeded = CFG.target / state.shyt;
    $("lever-price").textContent = usd(priceNeeded);
    $("lever-price-sub").textContent =
      compact(priceNeeded / state.price) + "× today's price · balance unchanged";

    // The honest caveat: lever 1 can be arithmetically out of reach.
    if (isFinite(state.totalSupply) && state.totalSupply > 0 && tokensNeeded > state.totalSupply) {
      flag.hidden = false;
      flag.innerHTML =
        "<b>Lever 1 is out of reach at today's price.</b> Reaching " +
        usdCompactish(CFG.target) + " purely by accumulation would require " +
        compact(tokensNeeded) + " SHYT, which is " +
        num((tokensNeeded / state.totalSupply) * 100, 0) +
        "% of a total supply of " + compact(state.totalSupply) +
        ". Every token in existence would not be enough. The threshold therefore depends on SHYT's " +
        "price rising, not on buybacks alone — a dependency worth understanding before treating " +
        "the target as a schedule.";
    }
  }

  function renderStats(state) {
    $("shyt-amt").textContent = isFinite(state.shyt) ? compact(state.shyt) : "—";
    $("shyt-price").textContent = isFinite(state.price) ? usd(state.price) : "—";

    if (isFinite(state.shyt) && isFinite(state.totalSupply) && state.totalSupply > 0) {
      $("shyt-supply-pct").textContent =
        ((state.shyt / state.totalSupply) * 100).toFixed(2) + "% of total supply";
    } else {
      $("shyt-supply-pct").textContent = "—";
    }

    $("eth-amt").textContent = isFinite(state.eth) ? num(state.eth, 4) + " ETH" : "—";
    $("eth-usd").textContent =
      isFinite(state.eth) && isFinite(state.ethUsd) ? usd(state.eth * state.ethUsd) : "—";

    var tx = state.transfers || [];
    var inbound = tx.filter(function (t) { return t.dir === "in"; });
    $("tx-count").textContent = inbound.length ? String(inbound.length) : "—";

    if (tx.length) {
      $("tx-window").textContent =
        utcDate(tx[tx.length - 1].ts).slice(0, 10) + " → " + utcDate(tx[0].ts).slice(0, 10);
    } else {
      $("tx-window").textContent = "—";
    }
  }

  function renderChart(state) {
    var svg = $("chart");
    var tx = (state.transfers || []).slice().reverse(); // oldest first
    svg.innerHTML = "";
    $("chart-axis").innerHTML = "";

    if (tx.length < 2) {
      $("chart-note").textContent = "not enough data";
      return;
    }

    var W = 860, H = 260, padT = 16, padB = 16, padL = 4, padR = 4;
    var pts = [];
    var cum = 0;
    for (var i = 0; i < tx.length; i++) {
      cum += tx[i].dir === "in" ? tx[i].amount : -tx[i].amount;
      pts.push({ t: new Date(tx[i].ts).getTime(), v: cum });
    }
    // extend flat to "now" so the last step is visible
    pts.push({ t: Date.now(), v: cum });

    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var vMax = Math.max.apply(null, pts.map(function (p) { return p.v; })) || 1;
    var span = Math.max(1, t1 - t0);

    var X = function (t) { return padL + ((t - t0) / span) * (W - padL - padR); };
    var Y = function (v) { return H - padB - (v / vMax) * (H - padT - padB); };

    // stepped path
    var d = "M " + X(pts[0].t) + " " + Y(0);
    for (var j = 0; j < pts.length; j++) {
      d += " L " + X(pts[j].t) + " " + Y(j === 0 ? pts[0].v : pts[j - 1].v);
      d += " L " + X(pts[j].t) + " " + Y(pts[j].v);
    }

    var ns = "http://www.w3.org/2000/svg";

    var grad = document.createElementNS(ns, "linearGradient");
    grad.setAttribute("id", "fillgrad");
    grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
    grad.innerHTML =
      '<stop offset="0%" stop-color="#5ee4a0" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="#5ee4a0" stop-opacity="0"/>';
    var defs = document.createElementNS(ns, "defs");
    defs.appendChild(grad);
    svg.appendChild(defs);

    // gridlines at 25/50/75/100%
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var ln = document.createElementNS(ns, "line");
      ln.setAttribute("x1", 0); ln.setAttribute("x2", W);
      ln.setAttribute("y1", Y(vMax * f)); ln.setAttribute("y2", Y(vMax * f));
      ln.setAttribute("stroke", "#232b3a");
      ln.setAttribute("stroke-width", "1");
      ln.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(ln);
    });

    var area = document.createElementNS(ns, "path");
    area.setAttribute("d", d + " L " + X(t1) + " " + Y(0) + " L " + X(t0) + " " + Y(0) + " Z");
    area.setAttribute("fill", "url(#fillgrad)");
    svg.appendChild(area);

    var line = document.createElementNS(ns, "path");
    line.setAttribute("d", d);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#5ee4a0");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);

    $("chart-note").textContent = "peak " + compact(vMax) + " SHYT";

    var ax = $("chart-axis");
    var a = document.createElement("span");
    a.textContent = utcDate(new Date(t0).toISOString()).slice(0, 10);
    var b = document.createElement("span");
    b.textContent = "now";
    ax.appendChild(a); ax.appendChild(b);
  }

  function renderSafe(state) {
    $("safe-link").textContent = CFG.treasury.address;
    $("safe-link").href = explorerAddr(CFG.treasury.address);

    $("safe-type").textContent = state.safeImpl
      ? "Gnosis Safe proxy → " + state.safeImpl
      : (state.isContract ? "Contract (implementation unknown)" : "Externally owned account");

    $("safe-version").textContent = state.safeVersion || "—";

    if (isFinite(state.threshold) && state.owners && state.owners.length) {
      $("safe-threshold").textContent =
        state.threshold + " of " + state.owners.length + " signatures required";
    } else {
      $("safe-threshold").textContent = "—";
    }

    var ul = $("owners");
    ul.innerHTML = "";
    if (!state.owners || !state.owners.length) {
      var li0 = document.createElement("li");
      li0.className = "muted";
      li0.textContent = "Could not read owners from the contract.";
      ul.appendChild(li0);
      return;
    }
    state.owners.forEach(function (o, i) {
      var li = document.createElement("li");
      var tag = document.createElement("span");
      tag.className = "owner-tag";
      tag.textContent = "Signer " + (i + 1);
      var a = document.createElement("a");
      a.href = explorerAddr(o);
      a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = o;
      li.appendChild(tag);
      li.appendChild(a);
      if (state.funders && state.funders[o.toLowerCase()]) {
        var t2 = document.createElement("span");
        t2.className = "owner-tag";
        t2.textContent = "funded treasury";
        li.appendChild(t2);
      }
      ul.appendChild(li);
    });
  }

  function renderTransfers(state) {
    var tbody = $("tx-body");
    var tx = state.transfers || [];
    tbody.innerHTML = "";

    if (!tx.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 6; td0.className = "muted";
      td0.textContent = "No ERC-20 transfers found for this address.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      $("flow-summary").textContent = "—";
      return;
    }

    var inQty = 0, outQty = 0;
    tx.forEach(function (t) { if (t.dir === "in") inQty += t.amount; else outQty += t.amount; });
    $("flow-summary").textContent =
      compact(inQty) + " in / " + compact(outQty) + " out";

    tx.forEach(function (t) {
      var tr = document.createElement("tr");

      var td1 = document.createElement("td");
      td1.className = "mono";
      td1.textContent = utcDate(t.ts);

      var td2 = document.createElement("td");
      var pill = document.createElement("span");
      pill.className = "pill " + t.dir;
      pill.textContent = t.dir === "in" ? "IN" : "OUT";
      td2.appendChild(pill);

      var td3 = document.createElement("td");
      td3.className = "num";
      td3.textContent = num(t.amount, 2) + " " + t.symbol;

      var td4 = document.createElement("td");
      td4.className = "num";
      td4.textContent = isFinite(state.price) ? usdCompactish(t.amount * state.price) : "—";

      var td5 = document.createElement("td");
      var cp = t.dir === "in" ? t.from : t.to;
      var a5 = document.createElement("a");
      a5.className = "addr";
      a5.href = explorerAddr(cp);
      a5.target = "_blank"; a5.rel = "noopener noreferrer";
      a5.textContent = shortAddr(cp);
      td5.appendChild(a5);

      var td6 = document.createElement("td");
      var a6 = document.createElement("a");
      a6.className = "addr";
      a6.href = explorerTx(t.hash);
      a6.target = "_blank"; a6.rel = "noopener noreferrer";
      a6.textContent = shortAddr(t.hash);
      td6.appendChild(a6);

      [td1, td2, td3, td4, td5, td6].forEach(function (td) { tr.appendChild(td); });
      tbody.appendChild(tr);
    });
  }

  function renderErrors() {
    var box = $("errors");
    if (!errors.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = "<b>Some data could not be loaded:</b>";
    var ul = document.createElement("ul");
    errors.forEach(function (e) {
      var li = document.createElement("li");
      li.textContent = e;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* ------------------------------------------------------------------ *
   * load
   * ------------------------------------------------------------------ */

  function load() {
    errors = [];
    var btn = $("refresh");
    btn.disabled = true;
    $("freshness").dataset.state = "loading";
    $("freshness").textContent = "Loading…";

    var safe = CFG.treasury.address;
    var api = CFG.chain.api;
    var reserve = CFG.reserve.address;

    Promise.all([
      soft(getJSON(api + "/addresses/" + safe, "address"), "address"),
      soft(getJSON(api + "/addresses/" + safe + "/token-balances", "balances"), "token balances"),
      soft(getJSON(api + "/addresses/" + safe + "/token-transfers?type=ERC-20", "transfers"), "transfers"),
      soft(getJSON(CFG.price.endpoint + reserve, "price"), "price feed"),
      soft(ethCall(safe, "0xa0e67e2b", "getOwners"), "Safe owners"),
      soft(ethCall(safe, "0xe75235b8", "getThreshold"), "Safe threshold"),
      soft(ethCall(safe, "0xffa1ad74", "VERSION"), "Safe version"),
    ]).then(function (res) {
      var addr = res[0], bals = res[1], xfers = res[2], px = res[3];
      var ownersHex = res[4], thrHex = res[5], verHex = res[6];

      var state = {
        eth: addr ? toUnits(addr.coin_balance, 18) : NaN,
        ethUsd: addr && addr.exchange_rate ? parseFloat(addr.exchange_rate) : NaN,
        isContract: addr ? !!addr.is_contract : false,
        safeImpl: addr && addr.implementations && addr.implementations.length
          ? (addr.implementations[0].name || shortAddr(addr.implementations[0].address_hash))
          : null,
        shyt: NaN,
        totalSupply: NaN,
        price: NaN,
        owners: ownersHex ? decodeAddressArray(ownersHex) : [],
        threshold: thrHex ? decodeUint(thrHex) : NaN,
        safeVersion: verHex ? decodeString(verHex) : "",
        transfers: [],
        funders: {},
      };

      // --- reserve balance
      if (Array.isArray(bals)) {
        for (var i = 0; i < bals.length; i++) {
          var b = bals[i];
          if (b.token && b.token.address_hash &&
              b.token.address_hash.toLowerCase() === reserve.toLowerCase()) {
            var dec = parseInt(b.token.decimals, 10) || CFG.reserve.decimals;
            state.shyt = toUnits(b.value, dec);
            state.totalSupply = toUnits(b.token.total_supply, dec);
            break;
          }
        }
        if (!isFinite(state.shyt)) state.shyt = 0;
      }

      // --- price
      if (px && px.data && px.data.attributes && px.data.attributes.token_prices) {
        var tp = px.data.attributes.token_prices;
        var key = Object.keys(tp).find(function (k) {
          return k.toLowerCase() === reserve.toLowerCase();
        });
        if (key) state.price = parseFloat(tp[key]);
      }

      // --- transfers (newest first, as Blockscout returns them)
      if (xfers && Array.isArray(xfers.items)) {
        state.transfers = xfers.items.map(function (t) {
          var dec = t.token && t.token.decimals ? parseInt(t.token.decimals, 10) : 18;
          var from = t.from && t.from.hash ? t.from.hash : "";
          var to = t.to && t.to.hash ? t.to.hash : "";
          return {
            ts: t.timestamp,
            symbol: (t.token && t.token.symbol) || "?",
            amount: toUnits(t.total && t.total.value, dec),
            from: from,
            to: to,
            hash: t.transaction_hash || t.tx_hash || "",
            dir: to.toLowerCase() === safe.toLowerCase() ? "in" : "out",
          };
        });
        state.transfers.forEach(function (t) {
          if (t.dir === "in" && t.from) state.funders[t.from.toLowerCase()] = true;
        });
      }

      state.treasuryUsd =
        (isFinite(state.shyt) && isFinite(state.price) ? state.shyt * state.price : 0) +
        (isFinite(state.eth) && isFinite(state.ethUsd) ? state.eth * state.ethUsd : 0);

      if (!isFinite(state.price)) state.treasuryUsd = NaN;

      renderHero(state);
      renderPath(state);
      renderStats(state);
      renderChart(state);
      renderSafe(state);
      renderTransfers(state);
      renderErrors();

      var f = $("freshness");
      f.dataset.state = errors.length ? "error" : "ok";
      f.textContent = "Updated " + new Date().toISOString().slice(11, 19) + " UTC";
      btn.disabled = false;
    });
  }

  $("refresh").addEventListener("click", load);
  load();
  setInterval(load, CFG.refreshSeconds * 1000);
})();
