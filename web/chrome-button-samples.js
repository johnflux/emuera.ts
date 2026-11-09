/** Each fixture is intentionally independent of app containers and ancestor styling. */
const samples = [
  { name: "Default / artwork demo / artwork retry / syntax tools", html: '<button class="ui-button" type="button">Artwork demo</button>' },
  { name: "Primary", html: '<button class="ui-button ui-button--primary" type="button">Install</button>' },
  { name: "Danger", html: '<button class="ui-button ui-button--danger" type="button">Delete</button>' },
  { name: "Quiet", html: '<button class="ui-button ui-button--quiet" type="button">Cancel</button>' },
  { name: "Small / copy diagnostics", html: '<button class="ui-button ui-button--small" type="button">Copy</button>' },
  { name: "Large", html: '<button class="ui-button ui-button--large" type="button">Continue</button>' },
  { name: "Tab selected", html: '<button class="ui-button ui-button--tab" type="button" role="tab" aria-selected="true">Selected</button>' },
  { name: "Disabled", html: '<button class="ui-button" type="button" disabled>Unavailable</button>' },
  { name: "ARIA disabled", html: '<button class="ui-button" type="button" aria-disabled="true">Unavailable</button>' },
  { name: "Hidden control", html: '<button class="ui-button" type="button" hidden>Hidden control</button>' },
  { name: "Danger disabled", html: '<button class="ui-button ui-button--danger" type="button" disabled>Delete</button>' },
  { name: "Busy", html: '<button class="ui-button ui-button--primary" type="button" aria-busy="true">Installing…</button>' },
  { name: "Pressed", html: '<button class="ui-button" type="button" aria-pressed="true">Enabled</button>' },
  { name: "Menu toggle", html: '<button class="ui-button ui-button--quiet ui-button--menu-toggle" type="button" aria-label="Menu" aria-expanded="false">☰</button>' },
  { name: "Menu expanded", html: '<button class="ui-button ui-button--quiet ui-button--menu-toggle" type="button" aria-label="Menu" aria-expanded="true">☰</button>' },
  { name: "Menu item", html: '<button class="ui-button ui-button--menu-item" type="button">Restart game…</button>' },
  { name: "Menu navigation link", html: '<a class="ui-button ui-button--menu-link" href="#components">UI components</a>' },
  { name: "Menu selected / expanded item", html: '<button class="ui-button ui-button--menu-item" type="button" aria-pressed="true">eraToho The World</button>' },
  { name: "Confirmation cancel", html: '<button class="ui-button ui-button--quiet" type="button">Cancel</button>' },
  { name: "Confirmation destructive", html: '<button class="ui-button ui-button--danger" type="button">Restart</button>' },
  { name: "Debug header", html: '<button class="ui-button ui-button--small" type="button">Minimize</button>' },
  { name: "Command submit", html: '<button class="ui-button ui-button--primary ui-button--small" type="button">Send</button>' },
  { name: "Settings heading close", html: '<button class="ui-button ui-button--quiet ui-button--settings-heading ui-button--dialog-close" type="button">Close</button>' },
  { name: "Settings reset", html: '<button class="ui-button ui-button--quiet ui-button--small ui-button--settings-heading ui-button--settings-reset" type="button">Reset all</button>' },
  { name: "Settings action", html: '<button class="ui-button ui-button--settings-action" type="button">LLM…</button>' },
  { name: "Controller menu action", html: '<button class="ui-button ui-button--controller" type="button">Restart</button>' },
  { name: "Controller menu danger", html: '<button class="ui-button ui-button--danger ui-button--controller" type="button">Exit</button>' },
  { name: "Controller menu quicksave", html: '<button class="ui-button ui-button--primary ui-button--controller" type="button">Quicksave</button>' },
  { name: "LLM / translation model action", html: '<button class="ui-button ui-button--small ui-button--llm" type="button">Load models</button>' },
  { name: "LLM cancel", html: '<button class="ui-button ui-button--quiet ui-button--llm" type="button">Cancel</button>' },
  { name: "LLM save", html: '<button class="ui-button ui-button--primary ui-button--llm ui-button--llm-save" type="button">Save</button>' },
  { name: "Translation save", html: '<button class="ui-button ui-button--primary ui-button--llm" type="button">Save</button>' },
  { name: "Library toggle", html: '<button class="ui-button ui-button--quiet ui-button--library-toggle" type="button">Game library</button>' },
  { name: "Library refresh", html: '<button class="ui-button ui-button--quiet ui-button--library-refresh" type="button">Refresh library</button>' },
  { name: "Library tab", html: '<button class="ui-button ui-button--tab ui-button--library-tab" type="button" role="tab" aria-selected="false">Not installed <span>12</span></button>' },
  { name: "Library selected tab", html: '<button class="ui-button ui-button--tab ui-button--library-tab" type="button" role="tab" aria-selected="true">Installed <span>1</span></button>' },
  { name: "Library primary", html: '<button class="ui-button ui-button--primary ui-button--library-primary" type="button">Play</button>' },
  { name: "Library starter install", html: '<button class="ui-button ui-button--primary ui-button--library-primary ui-button--library-starter" type="button">Install TW</button>' },
  { name: "Library download link", html: '<a class="ui-button ui-button--primary ui-button--library-primary" href="#downloads">Find downloads</a>' },
  { name: "Library disabled install", html: '<button class="ui-button ui-button--primary ui-button--library-primary" type="button" disabled>Installed</button>' },
  { name: "History send / cancel", html: '<button class="ui-button ui-button--history" type="button">Send</button>' },
  { name: "History more", html: '<button class="ui-button ui-button--history ui-button--history-more" type="button">more…</button>' },
  { name: "History close / artwork close", html: '<button class="ui-button ui-button--history ui-button--dialog-close" type="button">Close</button>' },
  { name: "History tab", html: '<button class="ui-button ui-button--history ui-button--history-tab" type="button" aria-pressed="false">Character card</button>' },
  { name: "History selected tab", html: '<button class="ui-button ui-button--history ui-button--history-tab" type="button" aria-pressed="true">History &amp; chat</button>' },
  { name: "History edit / resend", html: '<button class="ui-button ui-button--history ui-button--history-tool" type="button">Edit</button>' },
  { name: "History voice / card action", html: '<button class="ui-button ui-button--history" type="button">Download PNG card</button>' },
  { name: "History LLM configure", html: '<button class="ui-button ui-button--history ui-button--history-configure" type="button">LLM settings…</button>' },
  { name: "History disabled action", html: '<button class="ui-button ui-button--history" type="button" disabled>Write now</button>' },
  { name: "Icon close", html: '<button class="ui-button ui-button--quiet ui-button--icon-close" type="button" aria-label="Close">×</button>' },
  { name: "Controller close hint", html: '<button class="ui-button ui-button--quiet ui-button--dialog-close has-controller" type="button" data-controller-hint="B">Close</button>' },
  { name: "Continue hint", html: '<button class="ui-button ui-button--quiet ui-button--continue" type="button">Click to continue</button>' },
];

const modifierSamples = [
  ["Danger disabled", "ui-button--danger", "disabled", "Delete"],
  ["Menu item expanded", "ui-button--menu-item", 'aria-expanded="true"', "Settings…"],
  ["LLM hover / focus", "ui-button--llm", "", "Load models"],
  ["LLM save hover / focus", "ui-button--llm ui-button--llm-save", "", "Save"],
  ["History more hover / focus", "ui-button--history ui-button--history-more", "", "more…"],
  ["History edit hover / focus", "ui-button--history ui-button--history-tool", "", "Edit"],
  ["Controller action focus hint", "ui-button--controller has-controller", "", "Restart"],
  ["LLM action focus hint", "ui-button--llm has-controller", "", "Load models"],
  ["Confirmation focus hint", "has-controller", "", "Restart"],
  ["Settings action focus hint", "ui-button--settings-action has-controller", "", "LLM…"],
  ["Settings reset focus hint", "ui-button--settings-reset has-controller", "", "Reset all"],
];
for (const [name, classes, state, label] of modifierSamples) {
  if (!samples.some((sample) => sample.name === name)) {
    samples.push({ name, html: `<button class="ui-button ${classes}" type="button" ${state}>${label}</button>` });
  }
}

const seen = new Set();
export const chromeButtonSamples = samples.filter(({ html }) => {
  const key = html.slice(0, html.indexOf(">") + 1)
    .replace(/\s(?:type|aria-label|href)="[^"]*"/g, "").replace(/\s+/g, " ").replace(/\s+>/g, ">");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
export const CHROME_BUTTON_SAMPLES = chromeButtonSamples;
export default chromeButtonSamples;
