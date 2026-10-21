import { detectIssuer } from "../ccDetector.js";
import { parseCardStatement } from "./genericCard.js";

// HDFC: "DD/MM/YYYY" or "DD/MM/YYYY HH:MM:SS" dates, credits suffixed "Cr", and a reward-points
// column before the amount. Written from the published layout -- not yet checked against a sample.
const isHdfcCardLayout = (lines) => detectIssuer(lines)?.key === "hdfc";
const parseHdfcCard = (lines) => parseCardStatement(lines, { rewardPointsBeforeAmount: true });

export { isHdfcCardLayout, parseHdfcCard };
