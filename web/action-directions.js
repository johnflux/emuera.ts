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
