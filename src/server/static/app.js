const bootstrap = window.__MVI_BOOTSTRAP__ ?? {
  defaultLimit: 50,
  albumName: "AI Search Results",
};

const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query-input");
const limitInput = document.querySelector("#limit-input");
const searchButton = document.querySelector("#search-button");
const statusLine = document.querySelector("#status-line");
const albumName = document.querySelector("#album-name");
const errorPanel = document.querySelector("#error-panel");
const summaryPanel = document.querySelector("#summary-panel");
const resultsPanel = document.querySelector("#results-panel");
const summaryGrid = document.querySelector("#summary-grid");
const resultsBody = document.querySelector("#results-body");

limitInput.value = String(bootstrap.defaultLimit ?? 50);
albumName.textContent = bootstrap.albumName ?? "AI Search Results";

function setBusy(isBusy) {
  searchButton.disabled = isBusy;
  queryInput.disabled = isBusy;
  limitInput.disabled = isBusy;
  if (isBusy) {
    statusLine.textContent = "Searching...";
  }
}

function clearPanels() {
  errorPanel.classList.add("hidden");
  errorPanel.innerHTML = "";
  summaryPanel.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  summaryGrid.innerHTML = "";
  resultsBody.innerHTML = "";
}

function renderSummary(payload) {
  const entries = [
    ["Query", payload.query_text],
    ["Requested limit", payload.limit],
    ["Results returned", payload.result_count],
    ["Embeddings searched", payload.searched_embedding_count],
    ["Album target", payload.album_name],
    ["Album write mode", payload.album_write_mode],
    ["Requested asset writes", payload.requested_asset_count],
    ["Applied asset writes", payload.applied_asset_count],
    [
      "Unresolved results",
      Array.isArray(payload.unresolved_results) ? payload.unresolved_results.length : 0,
    ],
  ];

  summaryGrid.innerHTML = entries
    .map(
      ([label, value]) => `
        <div>
          <dt>${label}</dt>
          <dd>${value ?? "n/a"}</dd>
        </div>
      `
    )
    .join("");
  summaryPanel.classList.remove("hidden");
}

function renderResults(payload) {
  const rows = Array.isArray(payload.results) ? payload.results : [];

  if (rows.length === 0) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="5">No matches returned.</td>
      </tr>
    `;
  } else {
    resultsBody.innerHTML = rows
      .map(
        (result) => `
          <tr>
            <td>${result.rank ?? ""}</td>
            <td>${typeof result.score === "number" ? result.score.toFixed(4) : "n/a"}</td>
            <td>${result.asset_type ?? "unknown"}</td>
            <td>${result.representation_kind ?? "unknown"}</td>
            <td>${result.local_identifier ?? "missing-local-identifier"}</td>
          </tr>
        `
      )
      .join("");
  }

  resultsPanel.classList.remove("hidden");
}

function renderError(payload) {
  const diagnosticPath = payload?.details?.diagnostic_log_path;
  errorPanel.innerHTML = `
    <h2>Request failed</h2>
    <p class="error-code">${payload.code ?? "UNHANDLED_ERROR"}</p>
    <p>${payload.message ?? "Unknown error"}</p>
    ${diagnosticPath ? `<p>Diagnostic log: <code>${diagnosticPath}</code></p>` : ""}
  `;
  errorPanel.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearPanels();
  setBusy(true);

  const query = queryInput.value.trim();
  const limit = Number.parseInt(limitInput.value, 10);

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      renderError(payload);
      statusLine.textContent = "Search failed.";
      return;
    }

    renderSummary(payload);
    renderResults(payload);
    statusLine.textContent = `Search completed. ${payload.result_count ?? 0} result(s) returned.`;
  } catch (error) {
    renderError({
      code: "NETWORK_ERROR",
      message: error?.message ?? "Failed to reach local webserver.",
      details: null,
    });
    statusLine.textContent = "Search failed.";
  } finally {
    setBusy(false);
  }
});
