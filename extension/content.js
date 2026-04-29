(() => {
  const PANEL_ID = "amazon-total-amount-panel";
  const VERSION = "extension-v1";
  const CONCURRENCY = 3;
  const PAGE_WAIT = 16000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const queryAll = (selector, doc = document) => Array.from(doc.querySelectorAll(selector));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const text = (element) => clean((element && (element.innerText || element.textContent)) || "");
  const documentText = (doc) => text(doc.body);
  const formatYen = (amount) => "￥" + Math.round(amount).toLocaleString("ja-JP");

  const orderIdPattern = /\b\d{3}-\d{7}-\d{7}\b/g;
  const moneyPattern = /[￥¥]\s*([0-9,]+)(?:\.[0-9]+)?/g;
  const orderWords = /(注文日|注文番号|Order placed|Order #|Order number)/i;
  const totalWords = /(注文合計|ご注文合計|合計金額|お支払い金額|支払い金額|ご請求額|請求額|Order total|Total|合計)/i;
  const cancelWords = /(キャンセル済み|キャンセルされました|キャンセルされた|注文はキャンセル|この注文はキャンセル|Cancelled|Canceled|Order was cancelled|Order was canceled)/i;
  const refundWords = /(返金済み|返金されました|払い戻し済み|Refunded)/i;
  const nonTotalWords = /(小計|商品の小計|割引|返金|ポイント|送料|配送料|消費税|Subtotal|Discount|Refund|Points|Shipping|Tax)/i;

  let isRunning = false;

  function uniqueOrderIds(value) {
    return Array.from(new Set((value || "").match(orderIdPattern) || []));
  }

  function moneyAmounts(value) {
    const amounts = [];
    let match;

    moneyPattern.lastIndex = 0;
    while ((match = moneyPattern.exec(value || ""))) {
      amounts.push(Number(match[1].replace(/,/g, "")));
    }

    return amounts;
  }

  function expectedOrderCount(value) {
    const match = value.match(/([0-9,]+)\s*件の注文/) || value.match(/([0-9,]+)\s+orders/i);
    return match ? Number(match[1].replace(/,/g, "")) : 0;
  }

  function yearFromPage() {
    const match = (new URLSearchParams(location.search).get("timeFilter") || "").match(/year-(\d{4})/);
    return (match && match[1]) || String(new Date().getFullYear());
  }

  function amountAfterTotalLabel(value) {
    const pattern = /(注文合計|ご注文合計|合計金額|お支払い金額|支払い金額|ご請求額|請求額|Order total|Total|合計)[^￥¥]{0,260}[￥¥]\s*([0-9,]+)/gi;
    let match;

    while ((match = pattern.exec(value || ""))) {
      if (!nonTotalWords.test(match[0])) {
        return Number(match[2].replace(/,/g, ""));
      }
    }

    return null;
  }

  function amountFromCard(card) {
    const cardText = text(card);
    const total = amountAfterTotalLabel(cardText);

    if (total != null) {
      return total;
    }

    const amounts = moneyAmounts(cardText);
    return amounts.length === 1 ? amounts[0] : null;
  }

  function parsePage(doc) {
    const selector = [
      "[data-order-id]",
      "[data-order-number]",
      "[data-orderid]",
      ".order-card",
      ".js-order-card",
      '[class*="order-card"]',
      ".a-box-group",
      "article",
      "section",
      "li",
      "div",
    ].join(",");
    const bestById = new Map();

    for (const element of queryAll(selector, doc)) {
      const elementText = text(element);

      if (
        elementText.length < 25 ||
        elementText.length > 22000 ||
        !orderWords.test(elementText) ||
        !totalWords.test(elementText)
      ) {
        continue;
      }

      const attributes = [
        element.getAttribute("data-order-id"),
        element.getAttribute("data-order-number"),
        element.getAttribute("data-orderid"),
      ]
        .filter(Boolean)
        .join(" ");
      const ids = uniqueOrderIds(`${attributes} ${elementText}`);

      if (ids.length !== 1) {
        continue;
      }

      const id = ids[0];
      const total = amountFromCard(element);
      const cancelled = cancelWords.test(elementText);
      const refunded = refundWords.test(elementText);
      const score = (total == null ? 1000000 : 0) + elementText.length;
      const previous = bestById.get(id);

      if (!previous || score < previous.score) {
        bestById.set(id, { id, total, cancelled, refunded, score });
      }
    }

    const fullText = documentText(doc);
    const hits = [];
    let match;

    orderIdPattern.lastIndex = 0;
    while ((match = orderIdPattern.exec(fullText))) {
      hits.push({ id: match[0], index: match.index });
    }

    for (const hit of hits) {
      if (bestById.has(hit.id)) {
        continue;
      }

      const aroundOrderId = fullText.slice(Math.max(0, hit.index - 1400), Math.min(fullText.length, hit.index + 900));
      bestById.set(hit.id, {
        id: hit.id,
        total: amountAfterTotalLabel(aroundOrderId),
        cancelled: cancelWords.test(aroundOrderId),
        refunded: refundWords.test(aroundOrderId),
        score: 999999,
      });
    }

    return Array.from(bestById.values()).filter((row) => row.id);
  }

  function pageUrl(startIndex, year) {
    const url = new URL(location.href);
    url.searchParams.set("timeFilter", `year-${year}`);
    url.searchParams.set("startIndex", String(startIndex));
    url.searchParams.delete("ref_");
    return url.href;
  }

  function createFrame() {
    const frame = document.createElement("iframe");
    frame.style =
      "position:fixed;left:-9999px;top:-9999px;width:1280px;height:1100px;opacity:0;pointer-events:none";
    document.body.appendChild(frame);
    return frame;
  }

  async function loadFrame(frame, url) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("読み込みタイムアウト"));
        }
      }, 35000);

      frame.onload = () =>
        setTimeout(() => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(frame.contentDocument);
          }
        }, 1000);

      frame.src = url;
    });
  }

  async function waitRows(doc, targetCount) {
    const endAt = Date.now() + PAGE_WAIT;
    let bestRows = [];

    while (Date.now() < endAt) {
      const rows = parsePage(doc);

      if (rows.length > bestRows.length) {
        bestRows = rows;
      }

      if (rows.length >= targetCount) {
        break;
      }

      await sleep(550);
    }

    return bestRows;
  }

  function summarize(year, expectedOrders, byId, pages) {
    const all = Array.from(byId.values()).filter((row) => row.total != null && Number.isFinite(row.total));
    const recommended = all.filter((row) => !row.cancelled);
    const strict = all.filter((row) => !row.cancelled && !row.refunded);
    const cancelled = all.filter((row) => row.cancelled);
    const refunded = all.filter((row) => row.refunded && !row.cancelled);
    const sum = (rows) => rows.reduce((total, row) => total + row.total, 0);

    return {
      version: VERSION,
      year,
      expectedOrders: expectedOrders || null,
      recommendedTotal: sum(recommended),
      recommendedOrders: recommended.length,
      strictTotal: sum(strict),
      strictOrders: strict.length,
      allTotal: sum(all),
      allOrders: all.length,
      cancelledTotal: sum(cancelled),
      cancelledOrders: cancelled.length,
      refundedTotal: sum(refunded),
      refundedOrders: refunded.length,
      recommended,
      strict,
      all,
      cancelled,
      refunded,
      pages,
    };
  }

  function renderPanel() {
    const existing = document.getElementById(PANEL_ID);

    if (existing) {
      return existing;
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ata-header">
        <div class="ata-title">Amazon Total Amount</div>
        <button class="ata-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="ata-controls">
        <input class="ata-year" type="number" min="2000" max="2100" step="1" value="${yearFromPage()}" aria-label="集計年">
        <button class="ata-button" type="button">集計開始</button>
      </div>
      <div class="ata-status">注文履歴ページで集計できます。</div>
      <div class="ata-result"></div>
    `;

    document.body.appendChild(panel);
    panel.querySelector(".ata-close").addEventListener("click", () => panel.remove());
    panel.querySelector(".ata-button").addEventListener("click", () => runFromPanel(panel));
    return panel;
  }

  function setStatus(panel, message, isError = false) {
    const status = panel.querySelector(".ata-status");
    status.textContent = message;
    status.classList.toggle("ata-error", isError);
  }

  function renderResult(panel, result) {
    const resultNode = panel.querySelector(".ata-result");
    resultNode.innerHTML = `
      <div><b>Amazon ${result.year}年 合計（推奨）</b></div>
      <div class="ata-amount">${formatYen(result.recommendedTotal)}</div>
      <div>${result.recommendedOrders}件を集計 / 注文履歴表示 ${result.expectedOrders || "?"}件</div>
      <div class="ata-note">
        厳しめ ${formatYen(result.strictTotal)} /
        全金額あり ${formatYen(result.allTotal)} /
        返金扱い含む差額 ${formatYen(result.recommendedTotal - result.strictTotal)}
      </div>
    `;
  }

  async function runFromPanel(panel) {
    if (isRunning) {
      return;
    }

    const button = panel.querySelector(".ata-button");
    const yearInput = panel.querySelector(".ata-year");
    const year = String(yearInput.value || yearFromPage()).trim();

    isRunning = true;
    button.disabled = true;
    button.textContent = "集計中";
    panel.querySelector(".ata-result").textContent = "";

    try {
      const expectedOrders = expectedOrderCount(documentText(document));
      const starts = Array.from({ length: expectedOrders ? Math.ceil(expectedOrders / 10) : 100 }, (_, index) => index * 10);
      const byId = new Map();
      const pages = [];
      let nextIndex = 0;
      let donePages = 0;

      async function worker() {
        const frame = createFrame();

        try {
          while (nextIndex < starts.length) {
            const startIndex = starts[nextIndex++];
            const targetCount = expectedOrders ? Math.min(10, Math.max(0, expectedOrders - startIndex)) : 10;

            setStatus(
              panel,
              `Amazon ${year}年を集計中... ${Math.min(donePages + 1, starts.length)}/${starts.length}ページ`,
            );

            let rows = [];
            try {
              const doc = startIndex === 0 ? document : await loadFrame(frame, pageUrl(startIndex, year));
              rows = await waitRows(doc, targetCount);
            } catch (error) {
              pages.push({ startIndex, error: error.message });
              continue;
            }

            for (const row of rows) {
              const previous = byId.get(row.id);

              if (!previous || (row.total != null && !previous.total)) {
                byId.set(row.id, row);
              }
            }

            pages.push({ startIndex, found: rows.length });
            donePages += 1;
            await sleep(450);
          }
        } finally {
          frame.remove();
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, starts.length) }, () => worker()));

      const result = summarize(year, expectedOrders, byId, pages);
      window.AmazonAnnualTotal = result;
      console.clear();
      console.log("AmazonAnnualTotal", result);
      renderResult(panel, result);
      setStatus(panel, "集計が完了しました。");
    } catch (error) {
      console.error(error);
      setStatus(panel, `集計エラー: ${error.message || error}`, true);
    } finally {
      isRunning = false;
      button.disabled = false;
      button.textContent = "集計開始";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderPanel, { once: true });
  } else {
    renderPanel();
  }
})();
