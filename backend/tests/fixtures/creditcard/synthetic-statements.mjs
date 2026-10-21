// Synthetic, hand-written card statements (no real customer data) laid out the way each issuer
// prints them. Each statement reconciles exactly: previous + debits - credits (+ separate fees) = due.
// Replace/extend with redacted real samples as they arrive.

import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Renders statement lines as a real text PDF (one drawText per line, page by page) so tests can
// run the full pdf.js extraction pipeline. Helvetica is WinAnsi-only: no "₹" lines.
export async function writeStatementPdf(lines, filePath) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageNumbers = [...new Set(lines.map((line) => line.pageNumber))];
  for (const pageNumber of pageNumbers) {
    const page = pdf.addPage([595, 842]);
    lines
      .filter((line) => line.pageNumber === pageNumber)
      .forEach((line, index) =>
        page.drawText(line.text, { x: 40, y: 800 - index * 16, size: 9, font }),
      );
  }
  await writeFile(filePath, await pdf.save());
}

const pages = (...pageTexts) =>
  pageTexts.flatMap((texts, index) => texts.map((text) => ({ text, pageNumber: index + 1 })));

export const hdfc = {
  lines: pages(
    [
      "HDFC Bank Credit Card Statement",
      "Name : AKASH SHARMA",
      "Card No: 4375 XXXX XXXX 1234",
      "Statement Date 12/03/2024 Payment Due Date 01/04/2024",
      "Statement Period : 13/02/2024 to 12/03/2024",
      "Total Dues Minimum Amount Due Credit Limit Available Credit Limit Available Cash Limit",
      "8,181.29 410.00 2,00,000.00 1,91,818.71 80,000.00",
      "Opening Balance Payment/Credits Purchase/Debits Finance Charges",
      "10,000.00 10,500.00 8,681.29 0.00",
      "Domestic Transactions",
      "Date Transaction Description Feature Reward Points Amount (in Rs.)",
      "14/02/2024 13:22:05 SWIGGY BANGALORE 12 450.00",
      "15/02/2024 PAYMENT RECEIVED NEFT HDFC BANK 10,000.00 Cr",
      "16/02/2024 AMAZON PAY INDIA PRIVATE 20 2,000.00",
      "LIMITED BANGALORE",
      "18/02/2024 EMI PRINCIPAL 3/12 AMAZON 3,000.00",
      "18/02/2024 EMI INTEREST 3/12 AMAZON 320.00",
      "18/02/2024 IGST ON EMI INTEREST 57.60",
      "20/02/2024 REFUND AMAZON 500.00 Cr",
      "International Transactions",
      "22/02/2024 NETFLIX.COM LOS GATOS USD 15.49 1,300.00",
      "22/02/2024 FOREIGN CURRENCY MARKUP FEE 45.50",
      "22/02/2024 IGST ON MARKUP FEE 8.19",
      "Page 1 of 2",
    ],
    [
      "HDFC Bank Credit Card Statement",
      "Card No: 4375 XXXX XXXX 5678 PRIYA SHARMA",
      "25/02/2024 BIGBASKET MUMBAI 8 1,500.00",
      "Reward Points Summary",
      "Opening Balance Earned Redeemed Closing Balance",
      "01/03/2024 BONUS POINTS CREDITED 500.00",
      "Important Messages",
      "Pay your dues on time to avoid late payment charges of 1,300.00",
      "Page 2 of 2",
    ],
  ),
  expected: {
    issuer: "hdfc",
    count: 11,
    debits: 8681.29,
    credits: 10500,
    summary: {
      cardHolder: "AKASH SHARMA",
      cardLast4: "1234",
      totalAmountDue: 8181.29,
      minimumAmountDue: 410,
      creditLimit: 200000,
      availableCreditLimit: 191818.71,
      cashLimit: 80000,
      previousBalance: 10000,
      paymentsCredits: 10500,
      purchasesDebits: 8681.29,
      financeCharges: 0,
    },
  },
};

export const icici = {
  lines: pages([
    "ICICI Bank Credit Card Statement",
    "MR RAHUL VERMA",
    "Card Number 4315XXXXXXXX9012",
    "Statement Date : March 12, 2024",
    "Payment Due Date : April 1, 2024",
    "Total Amount due 5,250.00",
    "Minimum Amount due 270.00",
    "Credit Limit (Including cash) 1,50,000.00",
    "Available Credit (Including cash) 1,44,750.00",
    "Previous Balance 8,000.00",
    "Purchases / Charges 5,750.00",
    "Payments / Credits 8,500.00",
    "Date SerNo. Transaction Details Reward Points Intl.# amount Amount (in Rs)",
    "01/03/2024 10234567891 BBPS PAYMENT RECEIVED 8,000.00 CR",
    "03/03/2024 10234567892 AMAZON PAY IN 25 2,500.00",
    "05/03/2024 10234567893 UBER INDIA 5 250.00",
    "07/03/2024 10234567894 CASHBACK CREDIT 500.00 CR",
    "09/03/2024 10234567895 APPLE.COM/BILL 10 USD 35.00 3,000.00",
    "EMI Offers for you",
    "12/03/2024 CONVERT TO EMI AT 13% 25,000.00",
  ]),
  expected: {
    issuer: "icici",
    count: 5,
    debits: 5750,
    credits: 8500,
    summary: {
      cardHolder: "MR RAHUL VERMA",
      cardLast4: "9012",
      totalAmountDue: 5250,
      previousBalance: 8000,
    },
  },
};

export const sbi = {
  lines: pages([
    "SBI Card",
    "www.sbicard.com",
    "Credit Card Number XXXX XXXX XXXX 3456",
    "Statement Date 15 Mar 2024",
    "Payment Due Date 04 Apr 2024",
    "Total Amount Due Minimum Amount Due",
    "₹ 3,149.00 ₹ 160.00",
    "Credit Limit ₹ 60,000.00",
    "Previous Balance Payments, Reversals & other Credits Purchases & Other Debits Fee, Taxes & Interest Charges Total Outstanding",
    "4,000.00 4,000.00 2,950.00 199.00 3,149.00",
    "Date Transaction Details Amount (₹)",
    "18 Feb 24 PAYMENT RECEIVED 000PAYTM 4,000.00 C",
    "20 Feb 24 FLIPKART INTERNET 1,950.00 D",
    "02 Mar 24 ZOMATO LTD 1,000.00 D",
  ]),
  expected: {
    issuer: "sbi",
    count: 3,
    debits: 2950,
    credits: 4000,
    summary: {
      cardLast4: "3456",
      totalAmountDue: 3149,
      minimumAmountDue: 160,
      financeCharges: 199,
    },
  },
};

export const axis = {
  lines: pages([
    "Axis Bank Credit Card Statement",
    "Card No. 5334 XXXX XXXX 7788",
    "Name NEHA GUPTA",
    "Payment Due Date 05/04/2024 Statement Date 16/03/2024",
    "Total Payment Due 1,200.00 Dr",
    "Minimum Payment Due 60.00 Dr",
    "Credit Limit 50,000.00 Available Credit Limit 48,800.00",
    "Previous Balance 500.00 Dr",
    "DATE TRANSACTION DETAILS MERCHANT CATEGORY AMOUNT (Rs.) CASHBACK EARNED",
    "03/03/2024 MYNTRA BANGALORE APPAREL 1,000.00 Dr 15.00 Cr",
    "05/03/2024 SPOTIFY MUMBAI ENTERTAINMENT 200.00 Dr",
    "10/03/2024 BBPS PAYMENT RECEIVED 500.00 Cr",
  ]),
  expected: {
    issuer: "axis",
    count: 3,
    debits: 1200,
    credits: 500,
    summary: {
      cardHolder: "NEHA GUPTA",
      cardLast4: "7788",
      totalAmountDue: 1200,
      minimumAmountDue: 60,
      creditLimit: 50000,
    },
  },
};

// Kotak has no issuer file: exercises the generic engine, "-" credits, and a row repeated across
// a page break (the last row of page 1 printed again at the top of page 2).
export const kotakGeneric = {
  lines: pages(
    [
      "Kotak Mahindra Bank",
      "Credit Card Statement",
      "Card Holder Name: ANITA DESAI",
      "Statement Period: 01-Feb-2024 to 29-Feb-2024",
      "Minimum Amount Due Rs. 500.00",
      "Total Amount Due Rs. 9,900.00",
      "Payment Due Date 20-Mar-2024",
      "Total Credit Limit Rs. 1,00,000.00",
      "Previous Statement Balance Rs. 10,000.00",
      "Transaction Details",
      "02-Feb-2024 PAYMENT THANK YOU -10,000.00",
      "05-Feb-2024 MAKEMYTRIP NEW DELHI 9,000.00",
      "06-Feb-2024 GST @18% 162.00",
      "07-Feb-2024 ANNUAL FEE 738.00",
    ],
    ["Kotak Mahindra Bank", "07-Feb-2024 ANNUAL FEE 738.00", "Total 9,900.00"],
  ),
  expected: {
    issuer: "kotak",
    count: 4,
    duplicatesRemoved: 1,
    debits: 9900,
    credits: 10000,
    summary: {
      cardHolder: "ANITA DESAI",
      totalAmountDue: 9900,
      previousBalance: 10000,
      creditLimit: 100000,
    },
  },
};
