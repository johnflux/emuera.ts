const directions = {
  give: "Give: You to your partner",
  receive: "Receive: Your partner to you",
  both: "Both: You and your partner",
};

function directionOf(button) {
  const matches = Object.keys(directions).filter(direction => button.classList.contains(`era-action-${direction}`));
  if (matches.length > 1) throw new Error("An action must have only one direction class");
  return matches[0];
}

export function describeActionDirection(button, describe) {
  const direction = directionOf(button);
  if (!direction) return;
  const description = directions[direction];
  button.setAttribute("aria-description", description);
  describe(button, [button.dataset.tooltip, description].filter(Boolean).join("\n"));
}

export function setupActionDirectionFilters(main, state, canActivate) {
  if (main.dataset.closed !== "closed") return;
  const collection = main.querySelector(".era-actions-collection");
  const toggles = collection?.querySelector(".era-actions-header > .era-toggles");
  if (!toggles) return;
  const actions = [...collection.querySelectorAll(".era-actions-group button.era-button")];
  const marked = actions.filter(button => directionOf(button));
  if (!marked.length) return;

  function apply() {
    for (const button of marked) {
      const direction = directionOf(button);
      button.hidden = direction === "both" ? !state.give && !state.receive : !state[direction];
    }
    for (const group of collection.querySelectorAll(".era-actions-group")) {
      group.hidden = !group.querySelector("button:not([hidden])");
    }
    for (const button of toggles.querySelectorAll(".era-action-direction-filter")) {
      const on = state[button.dataset.direction];
      button.classList.toggle("era-current", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  if (!toggles.querySelector(".era-action-direction-filter")) {
    for (const direction of ["give", "receive"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice era-chip-button era-action-direction-filter";
      button.dataset.direction = direction;
      button.textContent = direction === "give" ? "Give" : "Receive";
      button.title = `Show ${direction === "give" ? "giving" : "receiving"} actions`;
      button.addEventListener("click", event => {
        if (!canActivate(button, event)) return;
        state[direction] = !state[direction];
        apply();
      });
      toggles.append(button);
    }
  }
  apply();
}
