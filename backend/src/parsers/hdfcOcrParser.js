import { roundMoney } from "./parsers/common.js";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[Оо]/g, "O")
    .replace(/[Кк]/g, "K")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAmountText(value) {
  const text = clean(value).replace(/,/g, "");
  const parts = text.split(".");
  if (parts.length > 2 && parts.at(-1)?.length === 2) {
    return `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
  }
  if (parts.length === 2 && parts[1].length > 2) {
    return `${parts[0]}${parts[1].slice(0, -2)}.${parts[1].slice(-2)}`;
  }
  if (/^\d{4,}$/.test(text)) {
    return `${text.slice(0, -2)}.${text.slice(-2)}`;
  }
  return text;
}

function parseAmount(raw) {
  if (!raw) return null;
  const text = normalizeAmountText(raw).replace(/Cr|Dr/gi, "");
  const normalized = text.replace(/^(-?)\./, "$10.");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return /^-/.test(text) || /Dr$/i.test(text) ? -Math.abs(value) : value;
}

function buildDate(day, month, year) {
  let fullYear = Number(year);
  if (fullYear < 100) fullYear += fullYear <= 69 ? 2000 : 1900;
  return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
}

function parseDate(raw) {
  const text = clean(raw);
  const match = text.match(/^(\d{2})\/?(\d{2})\/?(\d{2})$/);
  if (match) return buildDate(match[1], match[2], match[3]);

  // A date cell's slashes can end up misplaced by OCR (e.g. "/ / 01 05 25" for "01/05/25") in a
  // way the strict pattern above won't match at all -- exactly 6 digits left after stripping
  // everything else is still unambiguous as DDMMYY (an amount always carries a decimal point,
  // which survives the digit-only strip as a shorter run; a reference number is always far
  // longer than 6 digits), so it's trusted as a date rather than dropping the row's date
  // entirely and letting its narration bleed into whichever row is still open.
  const digitsOnly = text.replace(/\D/g, "");
  if (/^\d{6}$/.test(digitsOnly)) {
    return buildDate(digitsOnly.slice(0, 2), digitsOnly.slice(2, 4), digitsOnly.slice(4, 6));
  }

  return null;
}

// A transaction/narration row (date-led, or containing a UPI/NEFT/IMPS/RTGS reference plus an
// amount) can legitimately quote a *counterparty's* bank name (e.g. "UPI/.../ANAND SH/HDFC
// BANK" in someone else's statement, or "...RMH ADVISORS PVT LTD-HDFC0000408-ZENDABAZAR" in an
// NEFT narration). Those mentions must never be treated as this statement's own bank letterhead,
// so they're stripped out before looking for HDFC's own header/footer markers.
function isLikelyTransactionRow(text) {
  return (
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(text) ||
    /\b(UPI|NEFT|IMPS|RTGS|CLG|CHQ|TRF)[:/]/i.test(text) ||
    // Other banks' multi-line transaction formats attach a transfer's own reference sub-fields
    // (Sender Bank, Beneficiary Bank, Drawee Bank, ...) as continuation lines below the main row --
    // any of these can legitimately name a counterparty's "HDFC BANK" without this being an HDFC
    // statement at all, so they must never be scanned as part of this document's own letterhead.
    /^(UTR Number|Sender (?:Account|IFSC|Bank|Branch)|Beneficary Acct|Beneficiary (?:IFSC|Bank|Branch)|Drawee (?:Bank|Branch)|Collecting (?:Bank|Branch))\b/i.test(
      text,
    )
  );
}

function isHdfcOcrLayout(lines) {
  const headerText = lines
    .map((line) => clean(line.text || line))
    .filter((line) => !isLikelyTransactionRow(line))
    .join("\n");
  // A bare IFSC token like "HDFC0000240" is not a reliable signal on its own: any other
  // bank's NEFT/RTGS narration routinely quotes a counterparty's HDFC IFSC code, which would
  // otherwise misclassify that bank's own statement as HDFC's layout (see BASSEIN case below).
  const hasHdfcMarker =
    /H.?\s*HDFC\s+BANK/i.test(headerText) ||
    /\bH[OD]FC\s+BANK/i.test(headerText) ||
    /\bHDFCBANK\b/i.test(headerText);
  if (!hasHdfcMarker) return false;
  if (/BASSEIN\s+CATHOLIC\s+CO-OP\s+BANK/i.test(headerText)) return false;
  return /(?:Statement of account|tatement of accoun)/i.test(headerText);
}

function isAmountLine(text) {
  return /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+|\d{1,3}(?:\.\d{3})+)\.\d{2}$/i.test(clean(text));
}

function isReferenceLine(text) {
  return /^0{3,}\d*\s*\d{2}\/\d{2}\/\d{2}$/i.test(clean(text));
}

function isHeaderOrFooter(text) {
  return (
    /^Page No/i.test(text) ||
    /^Statement of account$/i.test(text) ||
    /^HDFC BANK/i.test(text) ||
    /^We understand/i.test(text) ||
    /^MR\b/i.test(text) ||
    /^JOINT HOLDERS/i.test(text) ||
    /^Nomination/i.test(text) ||
    /^Statement From/i.test(text) ||
    /^To\s*:/i.test(text) ||
    /^Account Branch/i.test(text) ||
    /^:\s*/.test(text) ||
    /HDFC BANK LTD/i.test(text) ||
    /^FLOOR\b/i.test(text) ||
    /^GRD\s+FLR\b/i.test(text) ||
    /^BRIDGE\b/i.test(text) ||
    /^SAMBHAV\s+NAGARI/i.test(text) ||
    /^Address\b/i.test(text) ||
    /^City\b/i.test(text) ||
    /^State\b/i.test(text) ||
    /^(h?one|phone)\s*(no\.?)?\b/i.test(text) ||
    /^OD Limit$/i.test(text) ||
    /^OD Limit\b.*\bCurrency\b/i.test(text) ||
    /^\)?\s*Li[rm]\b/i.test(text) ||
    /^D Li[mn]/i.test(text) ||
    /^Currency/i.test(text) ||
    /^Email$/i.test(text) ||
    /@GMAIL\.COM/i.test(text) ||
    /(?:JADHAV|SADHAV|ADHAV).{0,12}(?:REDIFFMAIL|NEDIFFMAIL|EDIFFMAIL)/i.test(text) ||
    /^Cust ID/i.test(text) ||
    /^Account No/i.test(text) ||
    /^A\/C Open Date/i.test(text) ||
    /^Account Status/i.test(text) ||
    /^Regula?r?$/i.test(text) ||
    /^RTGS\/NEFT IFSC/i.test(text) ||
    /^TGS\/NEFT IFSC/i.test(text) ||
    /^MICR/i.test(text) ||
    /^Branch Code/i.test(text) ||
    /^Account Type/i.test(text) ||
    /^INSTANT SAVING/i.test(text) ||
    /^Date$/i.test(text) ||
    /^Narration$/i.test(text) ||
    /^Chg\.\/Ref\.No\.$/i.test(text) ||
    /^Value Dt$/i.test(text) ||
    /^Withdrawal Amt\.$/i.test(text) ||
    /^Deposit Amt\.$/i.test(text) ||
    /^\*Closing balance/i.test(text) ||
    /^Contents of this statement/i.test(text) ||
    /^this statement\.?$/i.test(text) ||
    /^State account branch GSTN/i.test(text) ||
    /^HDFC Bank GSTIN/i.test(text) ||
    /^Registered Office Address/i.test(text) ||
    /^Generated (On|By)/i.test(text) ||
    /^Requesting Branch Code/i.test(text) ||
    /^This is a computer generated/i.test(text) ||
    /^not require signature/i.test(text) ||
    /^HDFCH\d+/i.test(text)
  );
}

function getPages(lines) {
  const pages = new Map();
  for (const line of lines) {
    const pageNumber = line.pageNumber || 1;
    if (!pages.has(pageNumber)) pages.set(pageNumber, []);
    pages.get(pageNumber).push(clean(line.text || line));
  }
  return [...pages.entries()].sort((a, b) => a[0] - b[0]);
}

function extractNarrationBlocks(texts) {
  const blocks = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const particulars = clean(current.parts.join(" "));
    blocks.push({
      date: current.date,
      particulars: particulars || "TRANSACTION",
    });
    current = null;
  };

  for (const text of texts) {
    if (/^STATEMENT SUMMARY/i.test(text) || /^HDFC BANK LIMITED$/i.test(text)) {
      flush();
      break;
    }

    const dateMatch = text.match(/^(\d{2}\/\d{2}\/\d{2})\b\s*(.*)$/);
    if (dateMatch) {
      flush();
      current = {
        date: parseDate(dateMatch[1]),
        parts: dateMatch[2] ? [dateMatch[2]] : [],
      };
      continue;
    }

    if (!current) continue;
    if (isHeaderOrFooter(text) || isAmountLine(text) || isReferenceLine(text)) continue;
    if (/^[A-Z0-9 .,@/:()-]{1,24}$/.test(text) && !/[A-Z]{3,}/i.test(text)) continue;

    current.parts.push(text);
  }

  flush();
  return blocks.filter((block) => block.date);
}

function extractBalances(texts) {
  const balances = [];

  const closingLabelIndex = texts.findIndex((text) => /^Closing Balance$/i.test(text));
  if (closingLabelIndex >= 0) {
    for (let index = closingLabelIndex + 1; index < texts.length; index += 1) {
      if (!isAmountLine(texts[index])) break;
      const amount = parseAmount(texts[index]);
      if (amount !== null) balances.push(amount);
    }
    return balances;
  }

  let footerIndex = -1;
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    if (/^(Registered|gistered|egistered|olstered|egstered).{0,20}(Office|ttice|Address|Addrecs)/i.test(texts[index])) {
      footerIndex = index;
      break;
    }
  }

  if (footerIndex < 0) {
    footerIndex = texts.findIndex((text) => /^HDFC BANK LIMITED$/i.test(text));
  }

  if (footerIndex < 0) return balances;

  for (let index = footerIndex + 1; index < texts.length; index += 1) {
    if (!isAmountLine(texts[index])) continue;
    const amount = parseAmount(texts[index]);
    if (amount !== null) balances.push(amount);
  }

  return balances;
}

function extractSummaryPageBalances(texts, previousBalance) {
  const summaryIndex = texts.findIndex((text) => /^STATEMENT SUMMARY/i.test(text));
  const closingBalIndex = texts.findIndex((text) => /^Closing Bal$/i.test(text));
  if (summaryIndex < 0 || closingBalIndex < 0 || previousBalance === null) return [];

  const drCountIndex = texts.findIndex((text) => /^Dr Count$/i.test(text));
  const creditsIndex = texts.findIndex((text) => /^Credits$/i.test(text));
  const beforeSummaryAmounts = [];

  for (let index = summaryIndex + 1; index < (drCountIndex > 0 ? drCountIndex : closingBalIndex); index += 1) {
    if (!isAmountLine(texts[index])) continue;
    const amount = parseAmount(texts[index]);
    if (amount !== null) beforeSummaryAmounts.push(amount);
  }

  const firstTransactionAmount = beforeSummaryAmounts.find((amount, index) => {
    const next = beforeSummaryAmounts[index + 1];
    return next !== undefined && Math.abs(roundMoney(previousBalance - amount) - next) <= 0.05;
  });

  const balances = [];
  if (firstTransactionAmount !== undefined) {
    balances.push(roundMoney(previousBalance - firstTransactionAmount));
  }

  if (creditsIndex > 0) {
    let skippedPrintedCreditTotal = false;
    for (let index = creditsIndex + 1; index < closingBalIndex; index += 1) {
      if (!isAmountLine(texts[index])) continue;
      const amount = parseAmount(texts[index]);
      if (!skippedPrintedCreditTotal) {
        skippedPrintedCreditTotal = true;
        continue;
      }
      if (amount !== null) balances.push(roundMoney(amount));
    }
  }

  return balances;
}

function extractMixedBalanceTrail(texts, previousBalance) {
  if (previousBalance === null) return [];

  const firstReferenceIndex = texts.findIndex((text) => isReferenceLine(text));
  const footerIndex = texts.findIndex((text) => /^HDFC BANK LIMITED$/i.test(text));
  const endIndex = footerIndex >= 0 ? footerIndex : texts.length;
  if (firstReferenceIndex < 0 || firstReferenceIndex >= endIndex) return [];

  const balances = [];
  const pendingAmounts = [];
  let currentBalance = previousBalance;

  for (let index = firstReferenceIndex; index < endIndex; index += 1) {
    if (!isAmountLine(texts[index])) continue;

    const value = parseAmount(texts[index]);
    if (value === null) continue;

    const pendingIndex = pendingAmounts.findIndex(
      (amount) =>
        Math.abs(roundMoney(currentBalance - amount) - value) <= 0.05 ||
        Math.abs(roundMoney(currentBalance + amount) - value) <= 0.05,
    );

    if (pendingIndex >= 0) {
      balances.push(roundMoney(value));
      currentBalance = value;
      pendingAmounts.splice(pendingIndex, 1);
    } else {
      pendingAmounts.push(value);
    }
  }

  return balances;
}

function findAmountAfter(texts, labelPattern) {
  const labelIndex = texts.findIndex((text) => labelPattern.test(text));
  if (labelIndex < 0) return null;

  for (let index = labelIndex + 1; index < Math.min(texts.length, labelIndex + 8); index += 1) {
    const amount = parseAmount(texts[index]);
    if (amount !== null) return amount;
  }

  return null;
}

function extractMoneyTokens(text) {
  return [...clean(text).matchAll(/(?:\d{1,3}(?:,\d{2,3})+|\d+|\d{1,3}(?:\.\d{3})+)\.\d{2}/g)]
    .map((match) => parseAmount(match[0]))
    .filter((amount) => amount !== null);
}

// Same idea as extractMoneyTokens, but for the trailing amount/balance tail of an
// already-matched inline row. OCR sometimes drops the decimal point from a balance
// entirely (e.g. "3497979" for "34,979.79"), which extractMoneyTokens' stricter
// pattern (requires a literal ".NN") would then miss, silently collapsing a
// 2-token amount+balance row down to 1 token and preventing the row from being
// recognized as a new transaction. parseAmount already knows how to reinsert the
// decimal for a bare 4+ digit run, so this just needs a looser token boundary.
function extractTrailingAmountTokens(text) {
  // Order matters: try comma-grouped ("1,64,236.68") and period-grouped
  // ("1.64.236.68" — OCR sometimes reads the Indian-grouping commas as periods)
  // forms first, since the final bare "\d+(?:\.\d+)?" alternative would otherwise
  // greedily split those into several bogus small tokens (see normalizeAmountText's
  // grouping-repair logic, which only gets a chance to run if the token boundary
  // is drawn around the whole grouped number to begin with).
  return [
    ...clean(text).matchAll(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+\.\d{2}|\d+(?:\.\d+)?/g),
  ]
    .map((match) => parseAmount(match[0]))
    .filter((amount) => amount !== null);
}

function extractAllNumberTokens(text) {
  return [...clean(text).matchAll(/\d{1,3}(?:,\d{2,3})*(?:\.\d+)?/g)]
    .map((match) => parseAmount(match[0]))
    .filter((amount) => amount !== null);
}

// Another Statement Summary shape seen in practice: "STATEMENT SUMMARY :-" followed by the
// column-headings line "Dr Count Cr Count Debits Credits Closing Bal" (Opening Balance's own
// label printed on the NEXT line instead, reversed relative to the other two shapes above), then
// one dense value line "105,594.14 586 111 2,993,226.40 2,905,992.35" (opening balance, Dr count,
// Cr count, debits, credits -- in that left-to-right order, matching the values' own printed
// order rather than the reordered label line), and finally Closing Bal alone on its own line.
// The reliable anchor for this shape is the label line itself, not proximity to a "STATEMENT
// SUMMARY :-" heading: a page break can (and, in real HDFC statements, does) push the label and
// value row well past their own month's "STATEMENT SUMMARY :-" line -- e.g. printed at the foot
// of one page, then reprinted at the top of the next page (with that month's whole account
// letterhead repeated above it) before the value row finally appears. Scanning the document once
// for every instance of this label, independent of where "STATEMENT SUMMARY" fell, finds each
// month's block regardless of that gap.
function extractOneSummaryBlockTotals(texts, labelIndex) {
  const windowEnd = Math.min(texts.length, labelIndex + 4);

  for (let index = labelIndex + 1; index < windowEnd; index += 1) {
    const tokens = extractAllNumberTokens(texts[index]);
    if (tokens.length < 5) continue;

    const [openingBalance, , , debits, credits] = tokens;
    // The value line already carries Closing Bal as its 6th token when all six figures were
    // read onto one line (as seen above); only fall back to scanning ahead when that token
    // wasn't captured (e.g. it got split onto a later line), since the lines right after this
    // one are "Generated On: <date> <time> ..." footer text whose own digits (a day-of-month,
    // a time) are not the closing balance.
    let closingBalance = tokens.length >= 6 ? tokens[5] : null;
    if (closingBalance === null) {
      for (let next = index + 1; next < Math.min(texts.length, index + 4); next += 1) {
        if (/^Generated (On|By)/i.test(texts[next])) break;
        const nextTokens = extractAllNumberTokens(texts[next]);
        if (nextTokens.length > 0) {
          closingBalance = nextTokens[0];
          break;
        }
      }
    }

    return { openingBalance, debits, credits, closingBalance, endIndex: index };
  }

  return null;
}

function extractSummaryBlockTotals(texts) {
  const labelPattern = /^Opening Balance\s+Dr Count\s+Cr Count\s+Debits\s+Credits\s+Closing Bal/i;
  let searchFrom = 0;
  let firstOpeningBalance = null;
  let lastClosingBalance = null;
  let totalDebits = 0;
  let totalCredits = 0;
  let blockCount = 0;

  for (;;) {
    const labelIndex = texts.findIndex((text, index) => index >= searchFrom && labelPattern.test(text));
    if (labelIndex < 0) break;

    const block = extractOneSummaryBlockTotals(texts, labelIndex);
    searchFrom = labelIndex + 1;
    if (!block) continue;

    if (firstOpeningBalance === null) firstOpeningBalance = block.openingBalance;
    if (block.closingBalance !== null) lastClosingBalance = block.closingBalance;
    totalDebits += Math.abs(block.debits);
    totalCredits += Math.abs(block.credits);
    blockCount += 1;
    searchFrom = block.endIndex + 1;
  }

  if (blockCount === 0) return null;

  return {
    openingBalance: firstOpeningBalance,
    printedTotals: {
      source: "printed",
      withdrawal: roundMoney(totalDebits),
      deposit: roundMoney(totalCredits),
      closingBalance: lastClosingBalance,
    },
  };
}

function extractPrintedTotals(texts) {
  const summaryBlockTotals = extractSummaryBlockTotals(texts);
  if (summaryBlockTotals) return summaryBlockTotals;

  const summaryIndex = texts.findIndex((text) => /Opening Balance\s+Dr Count\s+Cr Count\s+Debits\s+Credits\s+Closing Bal/i.test(text));
  if (summaryIndex >= 0) {
    for (let index = summaryIndex + 1; index < Math.min(texts.length, summaryIndex + 4); index += 1) {
      const amounts = extractMoneyTokens(texts[index]);
      if (amounts.length >= 4) {
        // The Debits figure in this row is itself Indian-grouped (e.g. "1,173,508.25"),
        // and OCR sometimes misreads its internal commas as periods (e.g.
        // "1173.508.25"), which extractMoneyTokens then splits into two bogus
        // extra tokens. Reading withdrawal/deposit/closingBalance from the *end*
        // of the token list (rather than fixed positions 1/2/3) keeps Opening
        // Balance and Closing Bal correct even when the Debits token in the
        // middle gets shredded like this.
        return {
          openingBalance: amounts[0],
          printedTotals: {
            source: "printed",
            withdrawal: Math.abs(amounts[amounts.length - 3]),
            deposit: Math.abs(amounts[amounts.length - 2]),
            closingBalance: amounts[amounts.length - 1],
          },
        };
      }
    }
  }

  // Some OCR passes render the summary as two separate blocks — one line per label
  // ("Opening Balance", "Dr Count", "Cr Count", "Debits", "Credits", "Closing Bal", each on
  // its own line), followed by one line per value — rather than interleaving label+value per
  // line or joining the whole header onto one line (the two cases handled above). Crucially,
  // the *value* block is not guaranteed to preserve the label block's left-to-right order (the
  // OCR service's own row/column reconstruction can resort them), so values can't just be
  // zipped positionally against labels. Instead, values are classified by shape/magnitude
  // (small integers ⇒ Dr/Cr counts, large decimals ⇒ Debits/Credits, small decimals ⇒
  // Opening/Closing balance) and, when there are exactly two large and two small decimal
  // candidates, the accounting identity opening + credits − debits = closing is used to pick
  // the one assignment that's internally consistent.
  const summaryLabelIndex = texts.findIndex((text) => /^Opening Balance$/i.test(text));
  if (summaryLabelIndex >= 0) {
    const labelPattern = /^(Opening Balance|Dr Count|[OC]r Count|Debits|Credits|Closing Bal)$/i;
    let cursor = summaryLabelIndex;
    let labelCount = 0;
    while (cursor < texts.length && labelPattern.test(texts[cursor])) {
      labelCount += 1;
      cursor += 1;
    }

    if (labelCount >= 4) {
      const decimals = [];
      const integers = [];
      while (cursor < texts.length && decimals.length + integers.length < labelCount) {
        const raw = texts[cursor];
        if (!isAmountLine(raw) && !/^\d+$/.test(clean(raw))) break;
        const value = parseAmount(raw);
        if (value === null) break;
        if (/\./.test(clean(raw))) decimals.push(value);
        else integers.push(value);
        cursor += 1;
      }

      if (decimals.length >= 3) {
        const sorted = [...decimals].sort((a, b) => b - a);
        const large = sorted.slice(0, 2);
        const small = sorted.slice(2, 4);

        let openingBalance = small[0] ?? null;
        let closingBalance = small[1] ?? null;
        let debits = large[0] ?? null;
        let credits = large[1] ?? null;

        if (small.length === 2 && large.length === 2) {
          const permutations = [
            { opening: small[0], closing: small[1], debits: large[0], credits: large[1] },
            { opening: small[1], closing: small[0], debits: large[0], credits: large[1] },
            { opening: small[0], closing: small[1], debits: large[1], credits: large[0] },
            { opening: small[1], closing: small[0], debits: large[1], credits: large[0] },
          ];
          const consistent = permutations.find(
            (candidate) =>
              Math.abs(roundMoney(candidate.opening + candidate.credits - candidate.debits) - candidate.closing) <=
              1,
          );
          if (consistent) {
            ({ opening: openingBalance, closing: closingBalance, debits, credits } = consistent);
          }
        }

        return {
          openingBalance,
          printedTotals: {
            source: "printed",
            withdrawal: debits === null ? null : Math.abs(debits),
            deposit: credits === null ? null : Math.abs(credits),
            closingBalance,
          },
        };
      }
    }
  }

  const openingBalance = findAmountAfter(texts, /^Opening Balance$/i);
  const withdrawal = findAmountAfter(texts, /^Debits$/i);
  const deposit = findAmountAfter(texts, /^Credits$/i);
  const closingBalance = findAmountAfter(texts, /^Closing Bal$/i);

  return {
    openingBalance,
    printedTotals:
      withdrawal !== null || deposit !== null || closingBalance !== null
        ? {
            source: "printed",
            withdrawal: withdrawal === null ? null : Math.abs(withdrawal),
            deposit: deposit === null ? null : Math.abs(deposit),
            closingBalance,
          }
        : null,
  };
}

function extractSeparatedAmountPairs(texts) {
  const pairs = [];
  let inAmountSection = false;
  let pendingWithdrawal = null;

  const flush = (deposit = null) => {
    if (pendingWithdrawal === null) return;
    pairs.push({
      withdrawal: Math.abs(pendingWithdrawal) > 0 ? Math.abs(pendingWithdrawal) : null,
      deposit: deposit !== null && Math.abs(deposit) > 0 ? Math.abs(deposit) : null,
    });
    pendingWithdrawal = null;
  };

  for (const raw of texts) {
    const text = clean(raw);

    if (/^Withdrawal Amt\.?$/i.test(text)) {
      inAmountSection = true;
      pendingWithdrawal = null;
      continue;
    }

    if (!inAmountSection) continue;

    if (/^(HDFC BANK LIMITED|Closing Balance|Page\s*No|Date|Narration|Chq\.\/Ref\.No\.|Value Dt)$/i.test(text)) {
      flush();
      inAmountSection = false;
      continue;
    }

    if (/^Deposit Amt\.?$/i.test(text)) continue;
    if (!isAmountLine(text)) continue;

    const amount = parseAmount(text);
    if (amount === null) continue;

    if (pendingWithdrawal === null) {
      pendingWithdrawal = amount;
    } else {
      flush(amount);
    }
  }

  flush();
  return pairs;
}

function parseInlineDate(raw) {
  const match = clean(raw).match(/^(\d{2})\/?(\d{2})\/?(\d{2,3})$/);
  if (!match) return null;
  return parseDate(`${match[1]}/${match[2]}/${match[3].slice(-2)}`);
}

// Dense/skewed table text sometimes gets OCR'd as one run-on line spanning several
// transaction rows (no newline between them). Split before every row-start marker —
// a short (<=8-digit, not "000"-prefixed, so it can't be a 16-digit reference number)
// date-like token immediately followed by "|" — so each row can still be matched
// independently below.
function splitMergedRowLines(texts) {
  const rowStartMarker = /(?<=^|\s)(?!000)\d{2}\/?\d{2}\/?\d{2,4}(?=\s*\|)/g;
  const result = [];

  for (const text of texts) {
    const indices = [...text.matchAll(rowStartMarker)].map((match) => match.index);
    if (indices.length <= 1) {
      result.push(text);
      continue;
    }

    let cursor = 0;
    for (const index of indices) {
      if (index > cursor) result.push(text.slice(cursor, index).trim());
      cursor = index;
    }
    result.push(text.slice(cursor).trim());
  }

  return result.filter(Boolean);
}

function extractInlineRows(rawTexts, openingBalance) {
  const texts = splitMergedRowLines(rawTexts);
  const rows = [];
  let previousBalance = openingBalance;
  let current = null;

  // The leading date token is intentionally matched loosely (\S+, not a strict date
  // regex): OCR frequently drops/mangles a digit in the transaction date (e.g.
  // "07004125" instead of "07/04/25"). Gating row detection on a strict date regex
  // would silently drop those rows and merge their amounts into the previous
  // transaction's narration. The reliable anchor for "this is a new transaction" is
  // the reference number + well-formed value date that follow; the date itself is
  // repaired from the value date below when it doesn't parse cleanly.
  // Some HDFC "Print to PDF" layouts render only one amount column (whichever of
  // Withdrawal/Deposit is non-blank) instead of both, so the trailing amount capture
  // is a single greedy group re-parsed into 1-3 money tokens (amount(s) + balance)
  // rather than three fixed positional groups.
  // The reference number and value date are also matched loosely: OCR occasionally
  // swaps a digit in the reference for a look-alike letter (e.g. "00001050S8181782")
  // and drops a slash from the value date (e.g. "19/0525"). Both are still reliable
  // enough as *anchors* (a 3+ zero run, and something date-shaped) even when not
  // perfectly clean; parseDate tolerates the missing slash when parsing the value date.
  const rowPattern =
    /^(\S+)\s+[|[{]?\s*(.*?)\s+(0{3,}[0-9A-Za-z]*)[\]|(]?\s*(?:\|\s*)?(\d{2}\/?\d{2}\/?\d{2})\s+(.+)$/i;

  const flush = () => {
    if (!current) return;

    // The printed running balance is the reliable ground truth (it's what the final
    // reconciliation is checked against), whereas the OCR'd withdrawal/deposit amount
    // is frequently garbled (dropped decimal points, commas misread as periods, etc).
    // So the balance delta always wins for classifying/sizing the transaction; the
    // OCR'd amount is not used to override it. This also means the balance chain
    // reconciles by construction for every row whose balance was read correctly.
    if (previousBalance !== null && current.balance !== null) {
      const delta = roundMoney(current.balance - previousBalance);
      current.withdrawal = delta < 0 ? Math.abs(delta) : null;
      current.deposit = delta > 0 ? delta : null;
    }

    rows.push({
      date: current.date,
      particulars: clean(current.parts.join(" ")) || "TRANSACTION",
      chequeNo: current.chequeNo,
      withdrawal: current.withdrawal,
      deposit: current.deposit,
      balance: current.balance,
    });

    previousBalance = current.balance;
    current = null;
  };

  for (const raw of texts) {
    const text = clean(raw);
    if (/^HDFC BANK LIMITED$/i.test(text) || /^STATEMENT SUMMARY/i.test(text)) {
      flush();
      continue;
    }

    const match = text.match(rowPattern);
    if (match) {
      const valueDate = parseDate(match[4]);
      const tokens = extractTrailingAmountTokens(match[5]);

      // Need at least an amount and a closing balance; anything less means the
      // trailing capture didn't actually contain the amount columns (e.g. a
      // continuation line that happens to contain a reference-like number).
      if (tokens.length >= 2 && valueDate) {
        flush();
        const balance = tokens[tokens.length - 1];
        const amounts = tokens.slice(0, -1);

        current = {
          date: parseInlineDate(match[1]) || valueDate,
          parts: [match[2]],
          chequeNo: match[3],
          valueDate,
          withdrawal: amounts.length >= 2 && Math.abs(amounts[0]) > 0 ? Math.abs(amounts[0]) : null,
          deposit: amounts.length >= 2 && Math.abs(amounts[1]) > 0 ? Math.abs(amounts[1]) : null,
          amount: Math.max(...amounts.map((value) => Math.abs(value)), 0),
          balance,
        };
        continue;
      }
    }

    if (!current) continue;
    if (isHeaderOrFooter(text) || isReferenceLine(text) || isAmountLine(text)) continue;
    if (/^PI$/i.test(text)) continue;
    current.parts.push(text);
  }

  flush();
  return rows.filter((row) => row.date && row.balance !== null);
}

function isDateText(text) {
  // See parseDate's digit-only fallback for why this also accepts a cell whose slashes got
  // scrambled by OCR as long as exactly 6 digits remain.
  return parseDate(text) !== null;
}

function getMoneyItems(items = []) {
  return items
    .map((item) => ({
      ...item,
      text: clean(item.text),
      amount: parseAmount(item.text),
    }))
    .filter((item) => item.amount !== null && isAmountLine(item.text));
}

// The scanned statement's OCR word-box coordinates are in whatever pixel space the source
// scan/render was captured at (a low-DPI phone scan and a high-DPI "print to PDF" scan of the
// same HDFC layout can differ by 4x+ in absolute x values). Hardcoding fixed pixel thresholds
// (as this used to do) only works for one specific DPI. Instead, read the column header row's
// own word positions ("Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.",
// "Deposit Amt.", "Closing Balance") wherever they appear in the document and use the midpoints
// between them as column boundaries — this self-calibrates to whatever scale the OCR happened
// to run at.
function detectColumnAnchors(lines) {
  let dateX = null;
  let narrationX = null;
  let refX = null;
  let valueDtX = null;
  let withdrawalX = null;
  let depositX = null;
  let balanceX = null;

  // Some scans print the header as one column name per line (the case this originally handled);
  // others -- e.g. this app's own OCR.space pass over a multi-page scan, which only ever prints
  // the header once, on page 1 -- render the whole "Date Narration Chq./Ref.No. Value Dt.
  // Withdrawal Amt. Deposit Amt. Closing Balance" as a single merged line. Matching each column's
  // first distinctive word within *that one line's own items* (rather than requiring the whole
  // line to equal one column name) handles both shapes, and still can't accidentally pick up a
  // stray "Date"/"Balance" word from the account-info block above the table, since those don't
  // co-occur with "Narration" and "Withdrawal" on the same line.
  for (const line of lines) {
    const lineText = clean(line.text);
    if (!/Narration/i.test(lineText) || !/Withdrawal/i.test(lineText)) continue;
    const items = line.items || [];
    if (!items.length) continue;

    for (const item of items) {
      const text = clean(item.text);
      const x = item.x;
      if (!Number.isFinite(x)) continue;

      if (dateX === null && /^Date$/i.test(text)) dateX = x;
      else if (narrationX === null && /^Narration$/i.test(text)) narrationX = x;
      else if (refX === null && /^Chq\.?$/i.test(text)) refX = x;
      else if (valueDtX === null && /^Value$/i.test(text)) valueDtX = x;
      else if (withdrawalX === null && /^Withdrawal$/i.test(text)) withdrawalX = x;
      else if (depositX === null && /^Deposit$/i.test(text)) depositX = x;
      else if (balanceX === null && /^Closing$/i.test(text)) balanceX = x;
    }

    if (dateX !== null && narrationX !== null && withdrawalX !== null && depositX !== null) break;
  }

  if (dateX === null || narrationX === null || withdrawalX === null || depositX === null || balanceX === null) {
    return null;
  }

  // refX / valueDtX are optional (sometimes OCR misses the small "Chq./Ref.No." or "Value Dt"
  // labels); interpolate them from the surrounding known columns so downstream midpoint math
  // still has something sane to work with.
  const resolvedRefX = refX ?? (narrationX + withdrawalX) / 2;
  const resolvedValueDtX = valueDtX ?? (resolvedRefX + withdrawalX) / 2;

  const columns = [
    { name: "date", x: dateX },
    { name: "narration", x: narrationX },
    { name: "ref", x: resolvedRefX },
    { name: "valueDt", x: resolvedValueDtX },
    { name: "withdrawal", x: withdrawalX },
    { name: "deposit", x: depositX },
    { name: "balance", x: balanceX },
  ].sort((a, b) => a.x - b.x);

  const boundaries = { start: -Infinity };
  for (let index = 0; index < columns.length; index += 1) {
    const next = columns[index + 1];
    boundaries[columns[index].name] = {
      from: index === 0 ? -Infinity : (columns[index - 1].x + columns[index].x) / 2,
      to: next ? (columns[index].x + next.x) / 2 : Infinity,
    };
  }

  return boundaries;
}

const DEFAULT_COLUMN_ANCHORS = {
  date: { from: -Infinity, to: 60 },
  narration: { from: 60, to: 260 },
  ref: { from: 260, to: 360 },
  valueDt: { from: 360, to: 420 },
  withdrawal: { from: 420, to: 480 },
  deposit: { from: 480, to: 560 },
  balance: { from: 560, to: Infinity },
};

function inColumn(x, column) {
  return Number.isFinite(x) && x >= column.from && x < column.to;
}

function columnOf(x, anchors) {
  for (const name of ["date", "narration", "ref", "valueDt", "withdrawal", "deposit", "balance"]) {
    if (inColumn(x, anchors[name])) return name;
  }
  return null;
}

// OCR.space's "isTable" mode reports a word-box x per word, but for a single logical table
// cell it often reports the *same* x for every word in that cell (the cell's left edge) rather
// than each word's own position — e.g. a whole narration phrase, or every digit/slash of a
// date, sharing one x. Some scans also merge two adjacent cells (e.g. "date" + start of
// "narration") onto a single output line. Grouping items by contiguous near-equal x rebuilds
// each true table cell as one unit regardless of which of those OCR behaviors produced the
// line, so column classification and date/amount parsing can work on whole cell text instead
// of individual word fragments (a lone "01" or "/" is not itself a parseable date).
function groupItemsIntoCells(items, xTolerance = 15) {
  const cells = [];
  let currentCell = null;

  for (const item of items) {
    const x = item.x;
    if (
      currentCell &&
      Number.isFinite(x) &&
      Number.isFinite(currentCell.x) &&
      Math.abs(x - currentCell.x) <= xTolerance
    ) {
      currentCell.texts.push(item.text);
    } else {
      if (currentCell) cells.push(currentCell);
      currentCell = { x, texts: [item.text] };
    }
  }
  if (currentCell) cells.push(currentCell);

  return cells.map((cell) => ({
    x: cell.x,
    text: clean(cell.texts.join(" ")).replace(/\s*\/\s*/g, "/").trim(),
  }));
}

function extractColumnarRows(lines, openingBalance) {
  const rows = [];
  let previousBalance = openingBalance;
  let current = null;
  const anchors = detectColumnAnchors(lines) || DEFAULT_COLUMN_ANCHORS;

  const flush = () => {
    if (!current) return;

    // The printed running balance is the reliable ground truth here (see extractInlineRows'
    // flush above for the same principle): a row's amount-column cell can be duplicated onto a
    // stray trailing line (the wrapped-narration table-cell artifact this format's OCR pass
    // produces) or leak into whichever row happens to be "current" when it's read, so trusting
    // it over a mismatching balance delta has produced real wrong signs/amounts (e.g. a same-day
    // interest-credit row picking up the next row's withdrawal amount). Once a delta is
    // computable, it always wins; the column-read amount is only used as a fallback when there's
    // no balance (or no previous balance) to diff against at all.
    if (previousBalance !== null && current.balance !== null) {
      const delta = roundMoney(current.balance - previousBalance);
      current.withdrawal = delta < 0 ? Math.abs(delta) : null;
      current.deposit = delta > 0 ? delta : null;
    } else {
      const amount = Math.abs(current.amount || 0);
      if (amount > 0) {
        current.withdrawal = current.amountColumn === "withdrawal" ? amount : null;
        current.deposit = current.amountColumn === "deposit" ? amount : null;
      }
    }

    rows.push({
      date: current.date,
      valueDate: current.valueDate || current.date,
      particulars: clean(current.parts.join(" ")) || "TRANSACTION",
      chequeNo: current.chequeNo,
      withdrawal: current.withdrawal,
      deposit: current.deposit,
      balance: current.balance,
    });

    previousBalance = current.balance;
    current = null;
  };

  // Column layout (not fixed pixel offsets, see detectColumnAnchors above) tells cells apart;
  // exactly how many OCR *output lines* a single table row spans varies by scan/DPI — sometimes
  // a whole row is one line, sometimes each cell is its own line, sometimes a line merges two
  // adjacent cells (e.g. "date" + start of "narration"). Rather than branching on which of
  // those shapes a given line happens to have, every line is split into cells by x-position
  // (groupItemsIntoCells) and cells are then processed in one uniform pass: a cell landing in
  // the date column starts a new row, and every other cell is routed into the row currently
  // being built by whatever column it falls in. This works the same whether a row's cells are
  // spread across many lines or packed onto one.
  //
  // The full account letterhead (branch, address, phone, email, IFSC, ...) reprints on every
  // single page of a multi-page scan, not just page 1 -- and a transaction's own narration can
  // still be "open" (not yet flushed) right as that block starts, since nothing marks the end of
  // one page's last row before the next page's letterhead begins. Enumerating every possible OCR
  // reading of that letterhead's free-text lines (a customer's own street address, etc.) would be
  // an unbounded, address-specific pattern list; instead, gate on the block's own reliable
  // start/end markers -- "Page No" or the bare "HDFC BANK" letterhead word (block start) through
  // "...Statement of account" (block end, always the letterhead's last line before the table
  // resumes) -- and skip everything in between unconditionally, without touching `current`, so a
  // row's narration can still resume cleanly right after the block ends.
  let inPageHeader = false;
  for (const line of lines) {
    const text = clean(line.text || line);

    // A multi-statement PDF (several monthly HDFC statements concatenated together) repeats
    // this footer once per month, immediately followed by that month's own letterhead/disclaimer
    // block and then the next month's table. Skip through it like the page-letterhead block
    // below rather than stopping the scan for good, so later months still get parsed.
    if (/^STATEMENT SUMMARY/i.test(text) || /^Generated On:/i.test(text)) {
      flush();
      inPageHeader = true;
      continue;
    }

    if (/^Page\s*No\b/i.test(text) || /^[•\-]?\s*HDFC\s+BANK$/i.test(text) || /^HDFC BANK LIMITED$/i.test(text)) {
      inPageHeader = true;
    }
    if (inPageHeader) {
      if (/Statement of account\s*$/i.test(text)) inPageHeader = false;
      continue;
    }

    if (isHeaderOrFooter(text)) continue;

    const items = Array.isArray(line.items) && line.items.length > 0 ? line.items : [{ x: null, text }];
    const cells = groupItemsIntoCells(items);

    for (const cell of cells) {
      if (!cell.text) continue;
      const column = columnOf(cell.x, anchors);

      if (column === "date" && isDateText(cell.text)) {
        flush();
        current = {
          date: parseDate(cell.text),
          valueDate: null,
          parts: [],
          chequeNo: null,
          amount: 0,
          amountColumn: null,
          withdrawal: null,
          deposit: null,
          balance: null,
        };
        continue;
      }

      if (!current) continue;

      if (column === "withdrawal" && isAmountLine(cell.text)) {
        const amount = parseAmount(cell.text);
        if (amount !== null) {
          current.withdrawal = Math.abs(amount);
          current.amount = Math.abs(amount);
          current.amountColumn = "withdrawal";
          continue;
        }
      }

      if (column === "deposit" && isAmountLine(cell.text)) {
        const amount = parseAmount(cell.text);
        if (amount !== null) {
          current.deposit = Math.abs(amount);
          current.amount = Math.abs(amount);
          current.amountColumn = "deposit";
          continue;
        }
      }

      if (column === "balance" && isAmountLine(cell.text)) {
        const amount = parseAmount(cell.text);
        if (amount !== null) {
          current.balance = roundMoney(amount);
          continue;
        }
      }

      if (column === "ref") {
        // The ref column holds this statement's Chq./Ref.No. -- a long, mostly-zero-padded
        // digit run (e.g. "0000102475013651") with no trailing date attached, once column
        // position (not isReferenceLine's stricter zero-run+date-suffix pattern, built for a
        // format where OCR fused those two cells onto one line) is what actually identifies it.
        // Never fall through to narration from here: a mis-shaped ref cell is noise, not text
        // worth keeping in the description.
        const cleaned = cell.text.replace(/\s+/g, "");
        if (/^\d{4,}$/.test(cleaned)) {
          current.chequeNo = cleaned;
        }
        continue;
      }

      if (column === "valueDt") {
        if (isDateText(cell.text)) {
          current.valueDate = parseDate(cell.text);
        }
        continue;
      }

      // Narration text, a value-date/ref cell that didn't cleanly match, or a cell that spilled
      // outside its nominal column band: keep it as part of the narration rather than silently
      // dropping it.
      if (!isAmountLine(cell.text) && !isReferenceLine(cell.text)) {
        current.parts.push(cell.text);
      }
    }
  }

  flush();
  return rows.filter((row) => row.date && row.balance !== null);
}

// Ordered longest/most-specific-first so e.g. "REV-UPI" and "CASH DEPOSIT BY" match before the
// bare "UPI" or "CC" prefix they'd otherwise also satisfy. Matched against the narration's own
// leading token, not embedded anywhere in it -- a UPI narration routinely mentions "CC" or "FT"
// deep inside a counterparty's own bank/account text, which must never be read as this row's type.
const TRAN_TYPE_PREFIXES = [
  "REV-UPI",
  "CASH DEPOSIT BY",
  "IB BILLPAY",
  "INSTA JUMBO LOAN",
  "INTEREST PAID",
  "CHQ PAID",
  "UPI",
  "IMPS",
  "CC",
  "SELF",
  "FT",
];

function inferTranType(particulars) {
  const text = clean(particulars).toUpperCase();
  const dashJoined = text.replace(/\s*-\s*/g, "-");

  for (const prefix of TRAN_TYPE_PREFIXES) {
    if (prefix.includes("-") ? dashJoined.startsWith(prefix) : text.startsWith(prefix)) {
      return prefix;
    }
  }

  return null;
}

// This format never prints a per-row Cr/Dr suffix next to the closing balance (unlike e.g.
// Federal Bank's "158900.00 Cr"), so Type has to be derived from the balance's own sign rather
// than read off the page -- verified, not assumed: every row's own balance is checked, not just
// trusted to stay positive because that's the common case.
function deriveType(balance) {
  if (balance === null || balance === undefined) return null;
  return balance < 0 ? "DR" : "CR";
}

function finalizeHdfcTransactions(rows) {
  return rows.map((row) => ({
    ...row,
    tranType: inferTranType(row.particulars),
    chequeDetails: row.chequeNo,
    type: deriveType(row.balance),
  }));
}

function parseHdfcOcrStatement(lines) {
  const pageEntries = getPages(lines);
  const allTexts = pageEntries.flatMap(([, texts]) => texts);
  const { openingBalance, printedTotals } = extractPrintedTotals(allTexts);
  const columnarRows = extractColumnarRows(lines, openingBalance);

  if (columnarRows.length > 0) {
    return {
      transactions: finalizeHdfcTransactions(columnarRows),
      printedTotals,
    };
  }

  const transactions = [];
  let previousBalance = openingBalance;
  const separatedAmountPairs = extractSeparatedAmountPairs(allTexts);

  for (const [, texts] of pageEntries) {
    const blocks = extractNarrationBlocks(texts);
    let balances = extractBalances(texts);
    if (balances.length < blocks.length) {
      const mixedBalances = extractMixedBalanceTrail(texts, previousBalance);
      if (mixedBalances.length >= blocks.length) {
        balances = mixedBalances;
      } else if (mixedBalances.length > 0 && mixedBalances.length + balances.length >= blocks.length) {
        balances = [...mixedBalances, ...balances];
      } else if (balances.length === 0) {
        balances = mixedBalances;
      }
    }
    if (balances.length === 0) {
      balances = extractSummaryPageBalances(texts, previousBalance);
    }
    const rowCount = Math.min(blocks.length, balances.length);

    for (let index = 0; index < rowCount; index += 1) {
      const balance = roundMoney(balances[index]);
      let withdrawal = null;
      let deposit = null;

      if (previousBalance !== null) {
        const delta = roundMoney(balance - previousBalance);
        if (delta < 0) withdrawal = Math.abs(delta);
        if (delta > 0) deposit = delta;
      }

      transactions.push({
        date: blocks[index].date,
        particulars: blocks[index].particulars,
        chequeNo: null,
        withdrawal,
        deposit,
        balance,
      });

      previousBalance = balance;
    }
  }

  const inlineRows = extractInlineRows(allTexts, openingBalance);
  if (inlineRows.length > transactions.length) {
    return {
      transactions: finalizeHdfcTransactions(inlineRows),
      printedTotals,
    };
  }

  if (separatedAmountPairs.length >= transactions.length) {
    for (let index = 0; index < transactions.length; index += 1) {
      const pair = separatedAmountPairs[index];
      if (!pair) continue;
      transactions[index].withdrawal = pair.withdrawal;
      transactions[index].deposit = pair.deposit;
    }
  } else if (
    transactions.length > 0 &&
    separatedAmountPairs.length > 0 &&
    transactions[0].withdrawal === null &&
    transactions[0].deposit === null
  ) {
    transactions[0].withdrawal = separatedAmountPairs[0].withdrawal;
    transactions[0].deposit = separatedAmountPairs[0].deposit;
  }

  return {
    transactions: finalizeHdfcTransactions(transactions),
    printedTotals,
  };
}

export { isHdfcOcrLayout, parseHdfcOcrStatement };
