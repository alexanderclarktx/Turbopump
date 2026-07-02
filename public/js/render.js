import { renderCheckouts } from "./checkouts.js";
import { renderFlowPane } from "./flows.js";
import { renderTickets } from "./tickets.js";

export function render() {
  renderCheckouts();
  renderTickets();
  renderFlowPane();
}
