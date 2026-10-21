import { detectIssuer } from "../ccDetector.js";
import { parseCardStatement } from "./genericCard.js";

// Axis: "Date | Transaction Details | Merchant Category | Amount (Rs.) | Cashback Earned", amounts
// suffixed "Dr"/"Cr". When the cashback column is filled, the transaction amount is the one before
// it. Written from the published layout -- not yet checked against a sample.
const isAxisCardLayout = (lines) => detectIssuer(lines)?.key === "axis";
const parseAxisCard = (lines) => parseCardStatement(lines, { trailingSecondaryAmount: true });

export { isAxisCardLayout, parseAxisCard };
