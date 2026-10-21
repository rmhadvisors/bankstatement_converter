import { detectIssuer } from "../ccDetector.js";
import { parseCardStatement } from "./genericCard.js";

// SBI Card: "DD MMM YY" dates and a "D"/"C" marker after every amount -- both handled by the
// engine's defaults. Written from the published layout -- not yet checked against a sample.
const isSbiCardLayout = (lines) => detectIssuer(lines)?.key === "sbi";
const parseSbiCard = (lines) => parseCardStatement(lines);

export { isSbiCardLayout, parseSbiCard };
