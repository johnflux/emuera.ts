export function createLibrary({ api, launch, gamesChanged, confirmAction }) {
  const root = document.querySelector("#library");
  const grid = document.querySelector("#game-grid");
  const notice = document.querySelector("#library-message");
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const refreshButton = document.querySelector("#library-refresh");
  const starter = document.querySelector("#library-starter");
  const catalogNote = document.querySelector("#catalog-note");
  let data = { installed: [], catalog: [] };
  let selected = 0;
  let working = false;

  function message(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle("error", error);
    notice.setAttribute("role", error ? "alert" : "status");
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function render() {
    const installed = new Set(data.installed.map((game) => game.catalogId));
    const available = data.catalog.filter((game) => !installed.has(game.id)).sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
    const tw = available.find((game) => game.id === "tw");
    if (starter) {
      starter.hidden = !tw;
      starter.replaceChildren();
    }
    if (starter && tw) {
      const copy = element("div", "");
      copy.append(element("p", "library-eyebrow", "NOT INSTALLED"),
        element("h3", "", "eraToho The World"),
        element("p", "", "One click downloads and installs the English ZIP. No Git required. Third-party game scripts: only install games you trust."));
      const button = element("button", "game-primary", working ? "Please wait..." : "Install TW");
      button.disabled = working;
      button.addEventListener("click", () => { void install(tw); });
      starter.append(copy, button);
    }
    catalogNote.hidden = selected === 0;
    catalogNote.textContent = `10 popular era-game repositories, ranked by GitGud stars (${data.catalogUpdated ?? "snapshot"}), plus TW, K, and Rance. Stars are not a compatibility rating.`;
    document.querySelector("#installed-count").textContent = data.installed.length;
    document.querySelector("#catalog-count").textContent = available.length;
    grid.replaceChildren();
    const games = selected === 0 ? data.installed : available;
    for (const [index, game] of games.entries()) {
      const card = element("article", "game-card");
      card.dataset.theme = String((data.catalog.findIndex((item) => item.id === (game.catalogId ?? game.id)) + 6) % 5);
      const art = element("div", "game-card-art");
      art.setAttribute("aria-hidden", "true");
      art.append(element("span", "game-card-number", String(index + 1).padStart(2, "0")),
        element("span", "game-card-monogram", game.monogram ?? game.title.replace(/^era/i, "").slice(0, 2).toUpperCase()),
        element("span", "game-card-orbit"));
      const content = element("div", "game-card-content");
      const meta = element("div", "game-card-meta");
      meta.append(element("span", "", game.genre), element("span", selected === 0 ? "game-ready" : "", selected === 0 ? "Installed" : game.stars !== undefined ? `${game.stars} stars` : "Discover"));
      const heading = element("h3", "", game.title);
      const blurb = element("p", "game-card-blurb", game.blurb);
      const actions = element("div", "game-card-actions");
      const button = element("button", "game-primary", selected === 0 ? "Play game" : game.archive ? "Install ZIP" : game.repository ? "Install with Git" : "Find downloads");
      button.disabled = working;
      button.setAttribute("aria-label", `${button.textContent}: ${game.title}`);
      if (selected === 0) button.addEventListener("click", () => launch(game.id));
      else if (game.archive || game.repository) button.addEventListener("click", () => { void install(game); });
      else {
        const link = element("a", "game-primary", "Find downloads");
        link.href = game.source;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      }
      if (selected === 0 || game.archive || game.repository) actions.append(button);
      const source = selected === 0 ? data.catalog.find((item) => item.id === game.catalogId)?.source : game.source;
      if (source) {
        const link = element("a", "game-source", "Project page ↗");
        link.href = source;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      }
      content.append(meta, heading, blurb, actions);
      if (selected === 1) {
        if (game.archive) {
          const zip = element("a", "game-source game-zip-link", "Download ZIP manually ↗");
          zip.href = game.archive;
          zip.target = "_blank";
          zip.rel = "noopener noreferrer";
          content.append(zip);
        }
        content.append(element("p", "game-install-note", game.archive
          ? `Downloads and extracts into GAMES/${game.folder}. No Git required.`
          : game.repository ? `Clones into GAMES/${game.folder}. Git required.`
            : game.requirements ? "Use the project's download and engine instructions."
              : `Download and extract into GAMES/${game.folder}, then refresh.`));
        if (game.requirements) content.append(element("p", "game-install-note game-requirements", game.requirements));
      }
      card.append(art, content);
      grid.append(card);
    }
    if (!games.length) {
      const empty = element("div", "library-empty");
      empty.append(element("h3", "", selected === 0 ? "No games installed." : "No games left to install."),
        element("p", "", selected === 0 ? "Check the Not installed tab, or put a game in GAMES/ and refresh." : "All listed games are installed. To add another game, put its folder in GAMES/ and refresh."));
      grid.append(empty);
    }
    refreshButton.disabled = working;
  }
  function select(index, focus = false) {
    selected = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    grid.setAttribute("aria-labelledby", tabs[index].id);
    render();
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      select(event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - selected, true);
    });
  });
  async function load() {
    data = await api("/api/library");
    render();
  }
  async function refresh() {
    if (working) return;
    working = true;
    render();
    message("Looking for games in GAMES/...");
    try {
      await api("/api/library/refresh", {});
      await gamesChanged();
      await load();
      message("Library refreshed.");
    } catch (error) { message(error.message, true); }
    finally { working = false; render(); }
  }
  async function install(game) {
    if (working) return;
    if (!game.archive && !await confirmAction(`Install ${game.title}?`,
      `This downloads third-party game scripts from ${game.source} into GAMES/${game.folder}. Only install games you trust. Existing folders will not be overwritten.`, "Clone game")) return;
    working = true;
    render();
    message(`${game.archive ? "Downloading and extracting" : "Cloning"} ${game.title} into GAMES/${game.folder}... This may take several minutes. Keep this page open.`);
    try {
      await api("/api/library/install", { id: game.id });
      await gamesChanged();
      await load();
      select(0);
      message(`${game.title} installed. Select Play game to begin.`);
      tabs[0].focus();
    } catch (error) { message(`${error.message} Use ${game.archive ? "Download ZIP manually" : "Project page"} to download an archive, extract it into GAMES/, then refresh.`, true); }
    finally { working = false; render(); }
  }
  refreshButton.addEventListener("click", () => { void refresh(); });
  return {
    async show() {
      document.body.classList.add("is-home");
      document.title = "Emuera.ts - Game library";
      document.querySelector("#status").textContent = "Select a game.";
      document.querySelector("#status").classList.remove("error");
      root.hidden = false;
      document.querySelector("#library-toggle").hidden = true;
      try {
        await load();
        message("Select Play game to start.");
      } catch (error) { message(`Could not load the library: ${error.message}. Try Refresh library.`, true); }
    },
    hide() {
      root.hidden = true;
      document.body.classList.remove("is-home");
      document.querySelector("#library-toggle").hidden = false;
    },
  };
}
