import { detectIssuer } from "../ccDetector.js";
import { parseCardStatement } from "./genericCard.js";

// ICICI: "Date | SerNo. | Transaction Details | Reward Points | Intl.# amount | Amount" with credits
// suffixed "CR". The leading SerNo. becomes refNo (the engine takes any 8+ digit first token).
// Written from the published layout -- not yet checked against a sample.
const isIciciCardLayout = (lines) => detectIssuer(lines)?.key === "icici";
const parseIciciCard = (lines) => parseCardStatement(lines, { rewardPointsBeforeAmount: true });

export { isIciciCardLayout, parseIciciCard };
