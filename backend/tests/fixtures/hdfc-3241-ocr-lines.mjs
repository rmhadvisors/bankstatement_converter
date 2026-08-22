// Real OCR.space output sliced from the actual scanned HDFC_3241.pdf (63 pages, 02/04/2025-31/03/2026),
// not a hand-transcribed fixture: page 1 in full (letterhead, the single-merged-line column header,
// the first 9 transactions, and the footer disclaimer), the start of page 2 (its own repeated
// letterhead block, ending in "...Statement of account", then two transactions -- one whose
// Withdrawal Amt. cell duplicates onto a stray trailing line below the wrapped narration, one whose
// Withdrawal Amt. cell is ONLY that stray trailing line, missing entirely from the row's own first
// line), and the tail of page 63 -- final transactions through the "STATEMENT SUMMARY" block, in
// this scan's own label-then-dense-value-line shape with Opening Balance printed AFTER, not before,
// the Dr Count/Cr Count/Debits/Credits/Closing Bal labels.
//
// Pages 3-62 (roughly 675 transactions) are deliberately omitted to keep this fixture small; that
// means the FIRST transaction row on page 63 has a fabricated balance delta (it's chained off the
// last page 2 row above, not the real page 62 row before it in the source PDF) and must not be
// asserted on for its own withdrawal/deposit amount -- every row after it is self-consistent again,
// since each row's own balance is read directly off the page, not derived.
//
// Exercises: page-break letterhead gating (extractColumnarRows' inPageHeader), the single-merged-line
// column header (detectColumnAnchors' per-word scan -- this only appears once, on page 1, which is
// why page 63 needs to stay in the SAME array rather than a standalone slice), the duplicate/floating
// amount-cell artifact (balance-delta-wins in flush()), and the reversed-order Statement Summary
// block (extractSummaryBlockTotals).
export const hdfc3241OcrLines = [
  {
    "pageNumber": 1,
    "text": "Page No .: 1",
    "items": [
      {
        "x": 2669,
        "text": "Page"
      },
      {
        "x": 2798,
        "text": "No"
      },
      {
        "x": 2878.5,
        "text": ".:"
      },
      {
        "x": 2929,
        "text": "1"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "• HDFC BANK",
    "items": [
      {
        "x": 516.5,
        "text": "•"
      },
      {
        "x": 792,
        "text": "HDFC"
      },
      {
        "x": 1266,
        "text": "BANK"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Account Branch : WADA",
    "items": [
      {
        "x": 3136.5,
        "text": "Account"
      },
      {
        "x": 3388.5,
        "text": "Branch"
      },
      {
        "x": 3530,
        "text": ":"
      },
      {
        "x": 3676,
        "text": "WADA"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "We understand your world",
    "items": [
      {
        "x": 390.5,
        "text": "We"
      },
      {
        "x": 770.5,
        "text": "understand"
      },
      {
        "x": 1176.5,
        "text": "your"
      },
      {
        "x": 1434,
        "text": "world"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "SHOP NO 113 114 ,",
    "items": [
      {
        "x": 3643,
        "text": "SHOP"
      },
      {
        "x": 3812.5,
        "text": "NO"
      },
      {
        "x": 3932.5,
        "text": "113"
      },
      {
        "x": 4062,
        "text": "114"
      },
      {
        "x": 4062,
        "text": ","
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "NILKANTH APARTMENT , OPP BSNL OFFICE",
    "items": [
      {
        "x": 3746.5,
        "text": "NILKANTH"
      },
      {
        "x": 4170,
        "text": "APARTMENT"
      },
      {
        "x": 4170,
        "text": ","
      },
      {
        "x": 4474.5,
        "text": "OPP"
      },
      {
        "x": 4641.5,
        "text": "BSNL"
      },
      {
        "x": 4864.5,
        "text": "OFFICE"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "WADA MANOR ROAD",
    "items": [
      {
        "x": 3674.5,
        "text": "WADA"
      },
      {
        "x": 3932.5,
        "text": "MANOR"
      },
      {
        "x": 4177,
        "text": "ROAD"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": ": WADA 421303",
    "items": [
      {
        "x": 3519.5,
        "text": ":"
      },
      {
        "x": 3670,
        "text": "WADA"
      },
      {
        "x": 3913,
        "text": "421303"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "MR VAIBHAV LAXMAN BHUSNAR",
    "items": [
      {
        "x": 413.5,
        "text": "MR"
      },
      {
        "x": 722,
        "text": "VAIBHAV"
      },
      {
        "x": 1056.5,
        "text": "LAXMAN"
      },
      {
        "x": 1395.5,
        "text": "BHUSNAR"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": ": MAHARASHTR /",
    "items": [
      {
        "x": 3539,
        "text": ":"
      },
      {
        "x": 3822,
        "text": "MAHARASHTR"
      },
      {
        "x": 3822,
        "text": "/"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "FLAT NO 102 B WING SAI DARSHAN APT",
    "items": [
      {
        "x": 438,
        "text": "FLAT"
      },
      {
        "x": 590.5,
        "text": "NO"
      },
      {
        "x": 710,
        "text": "102"
      },
      {
        "x": 805.5,
        "text": "B"
      },
      {
        "x": 943,
        "text": "WING"
      },
      {
        "x": 1110,
        "text": "SAI"
      },
      {
        "x": 1353.5,
        "text": "DARSHAN"
      },
      {
        "x": 1608,
        "text": "APT"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Phone no . 18002600 / 1800160",
    "items": [
      {
        "x": 3094.5,
        "text": "Phone"
      },
      {
        "x": 3254.5,
        "text": "no"
      },
      {
        "x": 3254.5,
        "text": "."
      },
      {
        "x": 3827.5,
        "text": "18002600"
      },
      {
        "x": 3827.5,
        "text": "/"
      },
      {
        "x": 3827.5,
        "text": "1800160"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": ": 0.00",
    "items": [
      {
        "x": 3527.5,
        "text": ":"
      },
      {
        "x": 3636,
        "text": "0.00"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "AT CHINCHGHAR PO KUDUS TAL WADA OD Limit",
    "items": [
      {
        "x": 400,
        "text": "AT"
      },
      {
        "x": 695.5,
        "text": "CHINCHGHAR"
      },
      {
        "x": 986.5,
        "text": "PO"
      },
      {
        "x": 1168,
        "text": "KUDUS"
      },
      {
        "x": 1372.5,
        "text": "TAL"
      },
      {
        "x": 1571,
        "text": "WADA"
      },
      {
        "x": 3064,
        "text": "OD"
      },
      {
        "x": 3216,
        "text": "Limit"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Currency",
    "items": [
      {
        "x": 3146.5,
        "text": "Currency"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "PALGHAR",
    "items": [
      {
        "x": 517,
        "text": "PALGHAR"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "KUDUS 421312 Cust ID",
    "items": [
      {
        "x": 468.5,
        "text": "KUDUS"
      },
      {
        "x": 719,
        "text": "421312"
      },
      {
        "x": 3079.5,
        "text": "Cust"
      },
      {
        "x": 3217.5,
        "text": "ID"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "MAHARASHTRA INDIA Account No",
    "items": [
      {
        "x": 619.5,
        "text": "MAHARASHTRA"
      },
      {
        "x": 1006,
        "text": "INDIA"
      },
      {
        "x": 3132,
        "text": "Account"
      },
      {
        "x": 3329.5,
        "text": "No"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "JOINT HOLDERS :",
    "items": [
      {
        "x": 446.5,
        "text": "JOINT"
      },
      {
        "x": 750,
        "text": "HOLDERS"
      },
      {
        "x": 750,
        "text": ":"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "MICR : 400240161",
    "items": [
      {
        "x": 4309.5,
        "text": "MICR"
      },
      {
        "x": 4309.5,
        "text": ":"
      },
      {
        "x": 4598,
        "text": "400240161"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "ranch Co",
    "items": [
      {
        "x": 3157.5,
        "text": "ranch"
      },
      {
        "x": 3281,
        "text": "Co"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Account Type : SAVINGS AC - RESIDENT 100 )",
    "items": [
      {
        "x": 3140.5,
        "text": "Account"
      },
      {
        "x": 3379,
        "text": "Type"
      },
      {
        "x": 3511.5,
        "text": ":"
      },
      {
        "x": 3705.5,
        "text": "SAVINGS"
      },
      {
        "x": 3943.5,
        "text": "AC"
      },
      {
        "x": 4032.5,
        "text": "-"
      },
      {
        "x": 4226.5,
        "text": "RESIDENT"
      },
      {
        "x": 4481.5,
        "text": "100"
      },
      {
        "x": 4481.5,
        "text": ")"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Nomination : Registered",
    "items": [
      {
        "x": 544.5,
        "text": "Nomination"
      },
      {
        "x": 544.5,
        "text": ":"
      },
      {
        "x": 909,
        "text": "Registered"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "From : 01 / 04 / 2025 To : 31 / 03 / 2026 Statement of account",
    "items": [
      {
        "x": 437,
        "text": "From"
      },
      {
        "x": 551.5,
        "text": ":"
      },
      {
        "x": 751,
        "text": "01"
      },
      {
        "x": 751,
        "text": "/"
      },
      {
        "x": 751,
        "text": "04"
      },
      {
        "x": 751,
        "text": "/"
      },
      {
        "x": 751,
        "text": "2025"
      },
      {
        "x": 1446,
        "text": "To"
      },
      {
        "x": 1526,
        "text": ":"
      },
      {
        "x": 1725,
        "text": "31"
      },
      {
        "x": 1725,
        "text": "/"
      },
      {
        "x": 1725,
        "text": "03"
      },
      {
        "x": 1725,
        "text": "/"
      },
      {
        "x": 1725,
        "text": "2026"
      },
      {
        "x": 3228,
        "text": "Statement"
      },
      {
        "x": 3509.5,
        "text": "of"
      },
      {
        "x": 3749,
        "text": "account"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Date Narration Chq ./ Ref.No . Value Dt Withdrawal Amt . Deposit Amt . Closing Balance",
    "items": [
      {
        "x": 479,
        "text": "Date"
      },
      {
        "x": 1465,
        "text": "Narration"
      },
      {
        "x": 2716.5,
        "text": "Chq"
      },
      {
        "x": 2716.5,
        "text": "./"
      },
      {
        "x": 2716.5,
        "text": "Ref.No"
      },
      {
        "x": 2716.5,
        "text": "."
      },
      {
        "x": 3285.5,
        "text": "Value"
      },
      {
        "x": 3451.5,
        "text": "Dt"
      },
      {
        "x": 3744,
        "text": "Withdrawal"
      },
      {
        "x": 4049.5,
        "text": "Amt"
      },
      {
        "x": 4049.5,
        "text": "."
      },
      {
        "x": 4440.5,
        "text": "Deposit"
      },
      {
        "x": 4658,
        "text": "Amt"
      },
      {
        "x": 4658,
        "text": "."
      },
      {
        "x": 5087,
        "text": "Closing"
      },
      {
        "x": 5344,
        "text": "Balance"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "02 / 04 / 25 UPI - AMAN ASLAM 0000102475013651 02 / 04 / 25 50,000.00 55,594.14",
    "items": [
      {
        "x": 473,
        "text": "02"
      },
      {
        "x": 473,
        "text": "/"
      },
      {
        "x": 473,
        "text": "04"
      },
      {
        "x": 473,
        "text": "/"
      },
      {
        "x": 473,
        "text": "25"
      },
      {
        "x": 857,
        "text": "UPI"
      },
      {
        "x": 857,
        "text": "-"
      },
      {
        "x": 857,
        "text": "AMAN"
      },
      {
        "x": 1176.5,
        "text": "ASLAM"
      },
      {
        "x": 2853,
        "text": "0000102475013651"
      },
      {
        "x": 3331.5,
        "text": "02"
      },
      {
        "x": 3331.5,
        "text": "/"
      },
      {
        "x": 3331.5,
        "text": "04"
      },
      {
        "x": 3331.5,
        "text": "/"
      },
      {
        "x": 3331.5,
        "text": "25"
      },
      {
        "x": 4012.5,
        "text": "50,000.00"
      },
      {
        "x": 5374,
        "text": "55,594.14"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "MUNSHI - 7786002100 @ AXL - UTI",
    "items": [
      {
        "x": 1148.5,
        "text": "MUNSHI"
      },
      {
        "x": 1148.5,
        "text": "-"
      },
      {
        "x": 1148.5,
        "text": "7786002100"
      },
      {
        "x": 1148.5,
        "text": "@"
      },
      {
        "x": 1148.5,
        "text": "AXL"
      },
      {
        "x": 1148.5,
        "text": "-"
      },
      {
        "x": 1148.5,
        "text": "UTI"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "B0000036 - 102475013651 - 120 PAYMENT MH43AW",
    "items": [
      {
        "x": 1108.5,
        "text": "B0000036"
      },
      {
        "x": 1108.5,
        "text": "-"
      },
      {
        "x": 1108.5,
        "text": "102475013651"
      },
      {
        "x": 1108.5,
        "text": "-"
      },
      {
        "x": 1108.5,
        "text": "120"
      },
      {
        "x": 1723.5,
        "text": "PAYMENT"
      },
      {
        "x": 2058,
        "text": "MH43AW"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "02 / 04 / 25 UPI - AMAN ASLAM 0000102475028236 02 / 04 / 25 50,000.00 5,594.14",
    "items": [
      {
        "x": 474,
        "text": "02"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "04"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "25"
      },
      {
        "x": 837.5,
        "text": "UPI"
      },
      {
        "x": 837.5,
        "text": "-"
      },
      {
        "x": 837.5,
        "text": "AMAN"
      },
      {
        "x": 1179.5,
        "text": "ASLAM"
      },
      {
        "x": 2842,
        "text": "0000102475028236"
      },
      {
        "x": 3327,
        "text": "02"
      },
      {
        "x": 3327,
        "text": "/"
      },
      {
        "x": 3327,
        "text": "04"
      },
      {
        "x": 3327,
        "text": "/"
      },
      {
        "x": 3327,
        "text": "25"
      },
      {
        "x": 4018.5,
        "text": "50,000.00"
      },
      {
        "x": 5395,
        "text": "5,594.14"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "MUNSHI - 7786002100 @ AXL - UTI",
    "items": [
      {
        "x": 1148.5,
        "text": "MUNSHI"
      },
      {
        "x": 1148.5,
        "text": "-"
      },
      {
        "x": 1148.5,
        "text": "7786002100"
      },
      {
        "x": 1148.5,
        "text": "@"
      },
      {
        "x": 1148.5,
        "text": "AXL"
      },
      {
        "x": 1148.5,
        "text": "-"
      },
      {
        "x": 1148.5,
        "text": "UTI"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "B0000036 - 102475028236 - 120 PAYMENT MH43AW",
    "items": [
      {
        "x": 1113.5,
        "text": "B0000036"
      },
      {
        "x": 1113.5,
        "text": "-"
      },
      {
        "x": 1113.5,
        "text": "102475028236"
      },
      {
        "x": 1113.5,
        "text": "-"
      },
      {
        "x": 1113.5,
        "text": "120"
      },
      {
        "x": 1720,
        "text": "PAYMENT"
      },
      {
        "x": 2055,
        "text": "MH43AW"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "03 / 04 / 25 UPI - SOHANLAL 0000102545501159 03 / 04 / 25 150.00 5,444.14",
    "items": [
      {
        "x": 474,
        "text": "03"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "04"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "25"
      },
      {
        "x": 931,
        "text": "UPI"
      },
      {
        "x": 931,
        "text": "-"
      },
      {
        "x": 931,
        "text": "SOHANLAL"
      },
      {
        "x": 2842,
        "text": "0000102545501159"
      },
      {
        "x": 3327,
        "text": "03"
      },
      {
        "x": 3327,
        "text": "/"
      },
      {
        "x": 3327,
        "text": "04"
      },
      {
        "x": 3327,
        "text": "/"
      },
      {
        "x": 3327,
        "text": "25"
      },
      {
        "x": 4056.5,
        "text": "150.00"
      },
      {
        "x": 5395,
        "text": "5,444.14"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "YADAV - YADAVSOHANLAL958 @ OKHD",
    "items": [
      {
        "x": 1290,
        "text": "YADAV"
      },
      {
        "x": 1290,
        "text": "-"
      },
      {
        "x": 1290,
        "text": "YADAVSOHANLAL958"
      },
      {
        "x": 1290,
        "text": "@"
      },
      {
        "x": 1290,
        "text": "OKHD"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "FCBANK - BARBOMAJIWA - 102545501159 - UPI",
    "items": [
      {
        "x": 1377.5,
        "text": "FCBANK"
      },
      {
        "x": 1377.5,
        "text": "-"
      },
      {
        "x": 1377.5,
        "text": "BARBOMAJIWA"
      },
      {
        "x": 1377.5,
        "text": "-"
      },
      {
        "x": 1377.5,
        "text": "102545501159"
      },
      {
        "x": 1377.5,
        "text": "-"
      },
      {
        "x": 1377.5,
        "text": "UPI"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "05 / 04 / 25 UPI - VAIBHAV LAXMAN 0000890381339826 10,000.00",
    "items": [
      {
        "x": 474,
        "text": "05"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "04"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "25"
      },
      {
        "x": 888.5,
        "text": "UPI"
      },
      {
        "x": 888.5,
        "text": "-"
      },
      {
        "x": 888.5,
        "text": "VAIBHAV"
      },
      {
        "x": 1311.5,
        "text": "LAXMAN"
      },
      {
        "x": 2842,
        "text": "0000890381339826"
      },
      {
        "x": 4693.5,
        "text": "10,000.00"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "05 / 04 / 25 15,444.14",
    "items": [
      {
        "x": 3310.5,
        "text": "05"
      },
      {
        "x": 3310.5,
        "text": "/"
      },
      {
        "x": 3310.5,
        "text": "04"
      },
      {
        "x": 3310.5,
        "text": "/"
      },
      {
        "x": 3310.5,
        "text": "25"
      },
      {
        "x": 5374,
        "text": "15,444.14"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "BHUSN - 9511686425 - 2 @ YB",
    "items": [
      {
        "x": 1067,
        "text": "BHUSN"
      },
      {
        "x": 1067,
        "text": "-"
      },
      {
        "x": 1067,
        "text": "9511686425"
      },
      {
        "x": 1067,
        "text": "-"
      },
      {
        "x": 1067,
        "text": "2"
      },
      {
        "x": 1067,
        "text": "@"
      },
      {
        "x": 1067,
        "text": "YB"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "L - UTIB0000605 - 890381339826 - PAYMENT FROM",
    "items": [
      {
        "x": 1311,
        "text": "L"
      },
      {
        "x": 1311,
        "text": "-"
      },
      {
        "x": 1311,
        "text": "UTIB0000605"
      },
      {
        "x": 1311,
        "text": "-"
      },
      {
        "x": 1311,
        "text": "890381339826"
      },
      {
        "x": 1311,
        "text": "-"
      },
      {
        "x": 1311,
        "text": "PAYMENT"
      },
      {
        "x": 2074,
        "text": "FROM"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "PHONE",
    "items": [
      {
        "x": 795,
        "text": "PHONE"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "05 / 04 / 25 UPI - ARCHAEOLOGICAL 0000509546185004 05 / 04 / 25 100.00 15,344.14",
    "items": [
      {
        "x": 474,
        "text": "05"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "04"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "25"
      },
      {
        "x": 1051,
        "text": "UPI"
      },
      {
        "x": 1051,
        "text": "-"
      },
      {
        "x": 1051,
        "text": "ARCHAEOLOGICAL"
      },
      {
        "x": 2842,
        "text": "0000509546185004"
      },
      {
        "x": 3316,
        "text": "05"
      },
      {
        "x": 3316,
        "text": "/"
      },
      {
        "x": 3316,
        "text": "04"
      },
      {
        "x": 3316,
        "text": "/"
      },
      {
        "x": 3316,
        "text": "25"
      },
      {
        "x": 4061,
        "text": "100.00"
      },
      {
        "x": 5374,
        "text": "15,344.14"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "SURVE - ARCHAEOLOGICALS",
    "items": [
      {
        "x": 1115.5,
        "text": "SURVE"
      },
      {
        "x": 1115.5,
        "text": "-"
      },
      {
        "x": 1115.5,
        "text": "ARCHAEOLOGICALS"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "23 . RZP @ ICICI - ICICODC0099 - 509546185004 - PA",
    "items": [
      {
        "x": 1399,
        "text": "23"
      },
      {
        "x": 1399,
        "text": "."
      },
      {
        "x": 1399,
        "text": "RZP"
      },
      {
        "x": 1399,
        "text": "@"
      },
      {
        "x": 1399,
        "text": "ICICI"
      },
      {
        "x": 1399,
        "text": "-"
      },
      {
        "x": 1399,
        "text": "ICICODC0099"
      },
      {
        "x": 1399,
        "text": "-"
      },
      {
        "x": 1399,
        "text": "509546185004"
      },
      {
        "x": 1399,
        "text": "-"
      },
      {
        "x": 1399,
        "text": "PA"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Y VIA RAZORPAY",
    "items": [
      {
        "x": 710.5,
        "text": "Y"
      },
      {
        "x": 808,
        "text": "VIA"
      },
      {
        "x": 1078,
        "text": "RAZORPAY"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "08 / 04 / 25 UPI - JO 0000264006918921 08 / 04 / 25 352.00 14,992.14",
    "items": [
      {
        "x": 474,
        "text": "08"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "04"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "25"
      },
      {
        "x": 779,
        "text": "UPI"
      },
      {
        "x": 779,
        "text": "-"
      },
      {
        "x": 779,
        "text": "JO"
      },
      {
        "x": 2842,
        "text": "0000264006918921"
      },
      {
        "x": 3326.5,
        "text": "08"
      },
      {
        "x": 3326.5,
        "text": "/"
      },
      {
        "x": 3326.5,
        "text": "04"
      },
      {
        "x": 3326.5,
        "text": "/"
      },
      {
        "x": 3326.5,
        "text": "25"
      },
      {
        "x": 4056.5,
        "text": "352.00"
      },
      {
        "x": 5373.5,
        "text": "14,992.14"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "RECHARGE - JOINAPPDIRECTI @ YBL - YES",
    "items": [
      {
        "x": 1322.5,
        "text": "RECHARGE"
      },
      {
        "x": 1322.5,
        "text": "-"
      },
      {
        "x": 1322.5,
        "text": "JOINAPPDIRECTI"
      },
      {
        "x": 1322.5,
        "text": "@"
      },
      {
        "x": 1322.5,
        "text": "YBL"
      },
      {
        "x": 1322.5,
        "text": "-"
      },
      {
        "x": 1322.5,
        "text": "YES"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "BOYBLUPI - 264006918921 - PAYMENT FROM",
    "items": [
      {
        "x": 1258,
        "text": "BOYBLUPI"
      },
      {
        "x": 1258,
        "text": "-"
      },
      {
        "x": 1258,
        "text": "264006918921"
      },
      {
        "x": 1258,
        "text": "-"
      },
      {
        "x": 1258,
        "text": "PAYMENT"
      },
      {
        "x": 1942,
        "text": "FROM"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "PHONE",
    "items": [
      {
        "x": 768,
        "text": "PHONE"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "12 / 04 / 25 CC 000517635XXXXXX7519 AUTOPAY SI - TAD 0000000660119656 12 / 04 / 25 5,199.80 9,792.34",
    "items": [
      {
        "x": 506.5,
        "text": "12"
      },
      {
        "x": 506.5,
        "text": "/"
      },
      {
        "x": 506.5,
        "text": "04"
      },
      {
        "x": 506.5,
        "text": "/"
      },
      {
        "x": 506.5,
        "text": "25"
      },
      {
        "x": 728.5,
        "text": "CC"
      },
      {
        "x": 1176,
        "text": "000517635XXXXXX7519"
      },
      {
        "x": 1737.5,
        "text": "AUTOPAY"
      },
      {
        "x": 2034.5,
        "text": "SI"
      },
      {
        "x": 2034.5,
        "text": "-"
      },
      {
        "x": 2034.5,
        "text": "TAD"
      },
      {
        "x": 2853,
        "text": "0000000660119656"
      },
      {
        "x": 3326.5,
        "text": "12"
      },
      {
        "x": 3326.5,
        "text": "/"
      },
      {
        "x": 3326.5,
        "text": "04"
      },
      {
        "x": 3326.5,
        "text": "/"
      },
      {
        "x": 3326.5,
        "text": "25"
      },
      {
        "x": 4034,
        "text": "5,199.80"
      },
      {
        "x": 5401.5,
        "text": "9,792.34"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "27 / 04 / 25 UPI - DREAM11 - DREAM11 @ YESPAY - YESBOYESUPI - 1 27 / 04 / 25 1.00",
    "items": [
      {
        "x": 486,
        "text": "27"
      },
      {
        "x": 486,
        "text": "/"
      },
      {
        "x": 486,
        "text": "04"
      },
      {
        "x": 486,
        "text": "/"
      },
      {
        "x": 486,
        "text": "25"
      },
      {
        "x": 1072.5,
        "text": "UPI"
      },
      {
        "x": 1072.5,
        "text": "-"
      },
      {
        "x": 1072.5,
        "text": "DREAM11"
      },
      {
        "x": 1072.5,
        "text": "-"
      },
      {
        "x": 1072.5,
        "text": "DREAM11"
      },
      {
        "x": 1072.5,
        "text": "@"
      },
      {
        "x": 1925.5,
        "text": "YESPAY"
      },
      {
        "x": 1925.5,
        "text": "-"
      },
      {
        "x": 1925.5,
        "text": "YESBOYESUPI"
      },
      {
        "x": 1925.5,
        "text": "-"
      },
      {
        "x": 1925.5,
        "text": "1"
      },
      {
        "x": 3315.5,
        "text": "27"
      },
      {
        "x": 3315.5,
        "text": "/"
      },
      {
        "x": 3315.5,
        "text": "04"
      },
      {
        "x": 3315.5,
        "text": "/"
      },
      {
        "x": 3315.5,
        "text": "25"
      },
      {
        "x": 4088.5,
        "text": "1.00"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "0000103874843071 9,791.34",
    "items": [
      {
        "x": 2842,
        "text": "0000103874843071"
      },
      {
        "x": 5395,
        "text": "9,791.34"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "03874843071 - PAYING TO DREAM11",
    "items": [
      {
        "x": 1017,
        "text": "03874843071"
      },
      {
        "x": 1017,
        "text": "-"
      },
      {
        "x": 1017,
        "text": "PAYING"
      },
      {
        "x": 1420,
        "text": "TO"
      },
      {
        "x": 1644.5,
        "text": "DREAM11"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "27 / 04 / 25 UPI - HARSHAL RAVINDRA 0000103883246958 12704 / 25 200.00",
    "items": [
      {
        "x": 478.5,
        "text": "27"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "04"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "25"
      },
      {
        "x": 885.5,
        "text": "UPI"
      },
      {
        "x": 885.5,
        "text": "-"
      },
      {
        "x": 885.5,
        "text": "HARSHAL"
      },
      {
        "x": 1352,
        "text": "RAVINDRA"
      },
      {
        "x": 2847.5,
        "text": "0000103883246958"
      },
      {
        "x": 3304.5,
        "text": "12704"
      },
      {
        "x": 3304.5,
        "text": "/"
      },
      {
        "x": 3304.5,
        "text": "25"
      },
      {
        "x": 4056.5,
        "text": "200.00"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "9,591.34",
    "items": [
      {
        "x": 5395.5,
        "text": "9,591.34"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "PAW - HARSHALPAWAR431",
    "items": [
      {
        "x": 1083,
        "text": "PAW"
      },
      {
        "x": 1083,
        "text": "-"
      },
      {
        "x": 1083,
        "text": "HARSHALPAWAR431"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "@ OKHDFCBANK - UBIN0559792 - 103883246958 - UPI",
    "items": [
      {
        "x": 1475.5,
        "text": "@"
      },
      {
        "x": 1475.5,
        "text": "OKHDFCBANK"
      },
      {
        "x": 1475.5,
        "text": "-"
      },
      {
        "x": 1475.5,
        "text": "UBIN0559792"
      },
      {
        "x": 1475.5,
        "text": "-"
      },
      {
        "x": 1475.5,
        "text": "103883246958"
      },
      {
        "x": 1475.5,
        "text": "-"
      },
      {
        "x": 1475.5,
        "text": "UPI"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "28 / 04 / 25 UPI - SHARADA LAXMAN",
    "items": [
      {
        "x": 478.5,
        "text": "28"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "04"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "25"
      },
      {
        "x": 898.5,
        "text": "UPI"
      },
      {
        "x": 898.5,
        "text": "-"
      },
      {
        "x": 898.5,
        "text": "SHARADA"
      },
      {
        "x": 1332,
        "text": "LAXMAN"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "0000103898414163 28 / 04 / 25 1.00 9,590.34",
    "items": [
      {
        "x": 2876,
        "text": "0000103898414163"
      },
      {
        "x": 3339,
        "text": "28"
      },
      {
        "x": 3339,
        "text": "/"
      },
      {
        "x": 3339,
        "text": "04"
      },
      {
        "x": 3339,
        "text": "/"
      },
      {
        "x": 3339,
        "text": "25"
      },
      {
        "x": 4088.5,
        "text": "1.00"
      },
      {
        "x": 5389.5,
        "text": "9,590.34"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "BHUSN - SHARDABHUSNAR7 -",
    "items": [
      {
        "x": 1126.5,
        "text": "BHUSN"
      },
      {
        "x": 1126.5,
        "text": "-"
      },
      {
        "x": 1126.5,
        "text": "SHARDABHUSNAR7"
      },
      {
        "x": 1126.5,
        "text": "-"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "2 @ OKHDFCBANK - HDFC0002246 - 103898414163 - UP",
    "items": [
      {
        "x": 1481,
        "text": "2"
      },
      {
        "x": 1481,
        "text": "@"
      },
      {
        "x": 1481,
        "text": "OKHDFCBANK"
      },
      {
        "x": 1481,
        "text": "-"
      },
      {
        "x": 1481,
        "text": "HDFC0002246"
      },
      {
        "x": 1481,
        "text": "-"
      },
      {
        "x": 1481,
        "text": "103898414163"
      },
      {
        "x": 1481,
        "text": "-"
      },
      {
        "x": 1481,
        "text": "UP"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "HDFC BANK LIMITED",
    "items": [
      {
        "x": 412,
        "text": "HDFC"
      },
      {
        "x": 656,
        "text": "BANK"
      },
      {
        "x": 962.5,
        "text": "LIMITED"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "* Closing balance includes funds earmarked for hold and uncleared funds",
    "items": [
      {
        "x": 422.5,
        "text": "*"
      },
      {
        "x": 422.5,
        "text": "Closing"
      },
      {
        "x": 670.5,
        "text": "balance"
      },
      {
        "x": 914,
        "text": "includes"
      },
      {
        "x": 1128,
        "text": "funds"
      },
      {
        "x": 1370.5,
        "text": "earmarked"
      },
      {
        "x": 1576,
        "text": "for"
      },
      {
        "x": 1694.5,
        "text": "hold"
      },
      {
        "x": 1828,
        "text": "and"
      },
      {
        "x": 2033,
        "text": "uncleared"
      },
      {
        "x": 2266.5,
        "text": "funds"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "Contents of this statement will be considered correct if no error is reported within 30 days of receipt of statement . The address on this statement is that on record with the Bank as at the day of requesting",
    "items": [
      {
        "x": 408.5,
        "text": "Contents"
      },
      {
        "x": 556,
        "text": "of"
      },
      {
        "x": 636.5,
        "text": "this"
      },
      {
        "x": 818,
        "text": "statement"
      },
      {
        "x": 999.5,
        "text": "will"
      },
      {
        "x": 1089.5,
        "text": "be"
      },
      {
        "x": 1271,
        "text": "considered"
      },
      {
        "x": 1500,
        "text": "correct"
      },
      {
        "x": 1618.5,
        "text": "if"
      },
      {
        "x": 1685.5,
        "text": "no"
      },
      {
        "x": 1786,
        "text": "error"
      },
      {
        "x": 1881,
        "text": "is"
      },
      {
        "x": 2019,
        "text": "reported"
      },
      {
        "x": 2215,
        "text": "within"
      },
      {
        "x": 2338.5,
        "text": "30"
      },
      {
        "x": 2443,
        "text": "days"
      },
      {
        "x": 2539,
        "text": "of"
      },
      {
        "x": 2662.5,
        "text": "receipt"
      },
      {
        "x": 2791.5,
        "text": "of"
      },
      {
        "x": 2953,
        "text": "statement"
      },
      {
        "x": 2953,
        "text": "."
      },
      {
        "x": 3130,
        "text": "The"
      },
      {
        "x": 3282,
        "text": "address"
      },
      {
        "x": 3420.5,
        "text": "on"
      },
      {
        "x": 3506.5,
        "text": "this"
      },
      {
        "x": 3682,
        "text": "statement"
      },
      {
        "x": 3835,
        "text": "is"
      },
      {
        "x": 3920.5,
        "text": "that"
      },
      {
        "x": 4011.5,
        "text": "on"
      },
      {
        "x": 4136,
        "text": "record"
      },
      {
        "x": 4283.5,
        "text": "with"
      },
      {
        "x": 4388,
        "text": "the"
      },
      {
        "x": 4506.5,
        "text": "Bank"
      },
      {
        "x": 4611.5,
        "text": "as"
      },
      {
        "x": 4674,
        "text": "at"
      },
      {
        "x": 4745,
        "text": "the"
      },
      {
        "x": 4840.5,
        "text": "day"
      },
      {
        "x": 4926.5,
        "text": "of"
      },
      {
        "x": 5096,
        "text": "requesting"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "State account branch GSTN : 27AAACH2702H1Z0",
    "items": [
      {
        "x": 358,
        "text": "State"
      },
      {
        "x": 551,
        "text": "account"
      },
      {
        "x": 764.5,
        "text": "branch"
      },
      {
        "x": 1251.5,
        "text": "GSTN"
      },
      {
        "x": 1251.5,
        "text": ":"
      },
      {
        "x": 1251.5,
        "text": "27AAACH2702H1Z0"
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "REced is dress : a an aud a pap apar has over are , malan in ay ments / online tax paymen / good - and service - tax .",
    "items": [
      {
        "x": 414.5,
        "text": "REced"
      },
      {
        "x": 643.5,
        "text": "is"
      },
      {
        "x": 853,
        "text": "dress"
      },
      {
        "x": 853,
        "text": ":"
      },
      {
        "x": 1072.5,
        "text": "a"
      },
      {
        "x": 1215.5,
        "text": "an"
      },
      {
        "x": 1387,
        "text": "aud"
      },
      {
        "x": 1530,
        "text": "a"
      },
      {
        "x": 1625,
        "text": "pap"
      },
      {
        "x": 1767.5,
        "text": "apar"
      },
      {
        "x": 1920.5,
        "text": "has"
      },
      {
        "x": 2082.5,
        "text": "over"
      },
      {
        "x": 2254.5,
        "text": "are"
      },
      {
        "x": 2254.5,
        "text": ","
      },
      {
        "x": 2436,
        "text": "malan"
      },
      {
        "x": 2606.5,
        "text": "in"
      },
      {
        "x": 2731,
        "text": "ay"
      },
      {
        "x": 2940.5,
        "text": "ments"
      },
      {
        "x": 2940.5,
        "text": "/"
      },
      {
        "x": 2940.5,
        "text": "online"
      },
      {
        "x": 3150,
        "text": "tax"
      },
      {
        "x": 3445.5,
        "text": "paymen"
      },
      {
        "x": 3445.5,
        "text": "/"
      },
      {
        "x": 3445.5,
        "text": "good"
      },
      {
        "x": 3445.5,
        "text": "-"
      },
      {
        "x": 3445.5,
        "text": "and"
      },
      {
        "x": 3849.5,
        "text": "service"
      },
      {
        "x": 3849.5,
        "text": "-"
      },
      {
        "x": 3849.5,
        "text": "tax"
      },
      {
        "x": 3849.5,
        "text": "."
      }
    ]
  },
  {
    "pageNumber": 1,
    "text": "O Scanned with OKEN Scanner",
    "items": [
      {
        "x": 4921.5,
        "text": "O"
      },
      {
        "x": 5085.5,
        "text": "Scanned"
      },
      {
        "x": 5244,
        "text": "with"
      },
      {
        "x": 5370,
        "text": "OKEN"
      },
      {
        "x": 5542.5,
        "text": "Scanner"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Page No .: 2",
    "items": [
      {
        "x": 2667.5,
        "text": "Page"
      },
      {
        "x": 2825,
        "text": "No"
      },
      {
        "x": 2825,
        "text": ".:"
      },
      {
        "x": 2934.5,
        "text": "2"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "HDFC BANK",
    "items": [
      {
        "x": 786,
        "text": "HDFC"
      },
      {
        "x": 1267,
        "text": "BANK"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Account Branch : WADA",
    "items": [
      {
        "x": 3140,
        "text": "Account"
      },
      {
        "x": 3388.5,
        "text": "Branch"
      },
      {
        "x": 3532,
        "text": ":"
      },
      {
        "x": 3674.5,
        "text": "WADA"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "We understand your world",
    "items": [
      {
        "x": 390.5,
        "text": "We"
      },
      {
        "x": 765,
        "text": "understand"
      },
      {
        "x": 1171.5,
        "text": "your"
      },
      {
        "x": 1434,
        "text": "world"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Address : SHOP NO 113 114 ,",
    "items": [
      {
        "x": 3136,
        "text": "Address"
      },
      {
        "x": 3527.5,
        "text": ":"
      },
      {
        "x": 3659.5,
        "text": "SHOP"
      },
      {
        "x": 3817,
        "text": "NO"
      },
      {
        "x": 3932.5,
        "text": "113"
      },
      {
        "x": 4062.5,
        "text": "114"
      },
      {
        "x": 4062.5,
        "text": ","
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "NILKANTH APARTMENT , OPP BSNL OFFICE",
    "items": [
      {
        "x": 3741.5,
        "text": "NILKANTH"
      },
      {
        "x": 4168,
        "text": "APARTMENT"
      },
      {
        "x": 4168,
        "text": ","
      },
      {
        "x": 4474,
        "text": "OPP"
      },
      {
        "x": 4649,
        "text": "BSNL"
      },
      {
        "x": 4875.5,
        "text": "OFFICE"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "WADA MANOR ROAD",
    "items": [
      {
        "x": 3670.5,
        "text": "WADA"
      },
      {
        "x": 3933,
        "text": "MANOR"
      },
      {
        "x": 4177,
        "text": "ROAD"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": ": WADA 421303",
    "items": [
      {
        "x": 3522,
        "text": ":"
      },
      {
        "x": 3674.5,
        "text": "WADA"
      },
      {
        "x": 3909.5,
        "text": "421303"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "City",
    "items": [
      {
        "x": 3081,
        "text": "City"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "MR VAIBHAV LAXMAN BHUSNAR",
    "items": [
      {
        "x": 413.5,
        "text": "MR"
      },
      {
        "x": 722,
        "text": "VAIBHAV"
      },
      {
        "x": 1056.5,
        "text": "LAXMAN"
      },
      {
        "x": 1395.5,
        "text": "BHUSNAR"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "State",
    "items": [
      {
        "x": 3087,
        "text": "State"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": ": MAHARASHTRA",
    "items": [
      {
        "x": 3517.5,
        "text": ":"
      },
      {
        "x": 3835.5,
        "text": "MAHARASHTRA"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "FLAT NO 102 B WING SAI DARSHAN APT",
    "items": [
      {
        "x": 441.5,
        "text": "FLAT"
      },
      {
        "x": 596,
        "text": "NO"
      },
      {
        "x": 714,
        "text": "102"
      },
      {
        "x": 807.5,
        "text": "B"
      },
      {
        "x": 941.5,
        "text": "WING"
      },
      {
        "x": 1109,
        "text": "SAI"
      },
      {
        "x": 1353,
        "text": "DARSHAN"
      },
      {
        "x": 1606.5,
        "text": "APT"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Phone no . : 18002600 / 18001600",
    "items": [
      {
        "x": 3099,
        "text": "Phone"
      },
      {
        "x": 3257.5,
        "text": "no"
      },
      {
        "x": 3257.5,
        "text": "."
      },
      {
        "x": 3533.5,
        "text": ":"
      },
      {
        "x": 3855,
        "text": "18002600"
      },
      {
        "x": 3855,
        "text": "/"
      },
      {
        "x": 3855,
        "text": "18001600"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "AT CHINCHGHAR PO KUDUS TAL WADA OD Limit : 0.00",
    "items": [
      {
        "x": 400.5,
        "text": "AT"
      },
      {
        "x": 698,
        "text": "CHINCHGHAR"
      },
      {
        "x": 991,
        "text": "PO"
      },
      {
        "x": 1174,
        "text": "KUDUS"
      },
      {
        "x": 1377,
        "text": "TAL"
      },
      {
        "x": 1570.5,
        "text": "WADA"
      },
      {
        "x": 3065.5,
        "text": "OD"
      },
      {
        "x": 3218.5,
        "text": "Limit"
      },
      {
        "x": 3522,
        "text": ":"
      },
      {
        "x": 3625.5,
        "text": "0.00"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": ": INR",
    "items": [
      {
        "x": 3530.5,
        "text": ":"
      },
      {
        "x": 3627,
        "text": "INR"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Currenc",
    "items": [
      {
        "x": 3141,
        "text": "Currenc"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "PALGHAR",
    "items": [
      {
        "x": 517,
        "text": "PALGHAR"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Email : VAIBHAVBHUSNAR915 @ GMAIL.COM",
    "items": [
      {
        "x": 3103,
        "text": "Email"
      },
      {
        "x": 3527.5,
        "text": ":"
      },
      {
        "x": 4181.5,
        "text": "VAIBHAVBHUSNAR915"
      },
      {
        "x": 4181.5,
        "text": "@"
      },
      {
        "x": 4181.5,
        "text": "GMAIL.COM"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "KUDUS 421312",
    "items": [
      {
        "x": 469.5,
        "text": "KUDUS"
      },
      {
        "x": 713.5,
        "text": "421312"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Cust ID : 137797587",
    "items": [
      {
        "x": 3088,
        "text": "Cust"
      },
      {
        "x": 3207,
        "text": "ID"
      },
      {
        "x": 3527.5,
        "text": ":"
      },
      {
        "x": 3723,
        "text": "137797587"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "MAHARASHTRA INDIA : 50100339813241 PRIME POTENTIAL",
    "items": [
      {
        "x": 619.5,
        "text": "MAHARASHTRA"
      },
      {
        "x": 1005,
        "text": "INDIA"
      },
      {
        "x": 3519,
        "text": ":"
      },
      {
        "x": 3821,
        "text": "50100339813241"
      },
      {
        "x": 4214,
        "text": "PRIME"
      },
      {
        "x": 4533.5,
        "text": "POTENTIAL"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Account No",
    "items": [
      {
        "x": 3132.5,
        "text": "Account"
      },
      {
        "x": 3323.5,
        "text": "No"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "JOINT HOLDERS : : Regular",
    "items": [
      {
        "x": 442,
        "text": "JOINT"
      },
      {
        "x": 745,
        "text": "HOLDERS"
      },
      {
        "x": 745,
        "text": ":"
      },
      {
        "x": 3540,
        "text": ":"
      },
      {
        "x": 3683,
        "text": "Regular"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "MICR : 400240161",
    "items": [
      {
        "x": 4292.5,
        "text": "MICR"
      },
      {
        "x": 4414.5,
        "text": ":"
      },
      {
        "x": 4596.5,
        "text": "400240161"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Branch Cod : 2246",
    "items": [
      {
        "x": 3130.5,
        "text": "Branch"
      },
      {
        "x": 3299.5,
        "text": "Cod"
      },
      {
        "x": 3534,
        "text": ":"
      },
      {
        "x": 3641.5,
        "text": "2246"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": ": SAVINGS A / C - RESIDENT ( 100 )",
    "items": [
      {
        "x": 3516.5,
        "text": ":"
      },
      {
        "x": 3717,
        "text": "SAVINGS"
      },
      {
        "x": 3948.5,
        "text": "A"
      },
      {
        "x": 3948.5,
        "text": "/"
      },
      {
        "x": 3948.5,
        "text": "C"
      },
      {
        "x": 4033.5,
        "text": "-"
      },
      {
        "x": 4303,
        "text": "RESIDENT"
      },
      {
        "x": 4303,
        "text": "("
      },
      {
        "x": 4303,
        "text": "100"
      },
      {
        "x": 4303,
        "text": ")"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Account Type",
    "items": [
      {
        "x": 3142,
        "text": "Account"
      },
      {
        "x": 3381.5,
        "text": "Type"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "Nomination : Registered",
    "items": [
      {
        "x": 519.5,
        "text": "Nomination"
      },
      {
        "x": 715.5,
        "text": ":"
      },
      {
        "x": 904,
        "text": "Registered"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "From : 01 / 04 / 2025 To : 31 / 03 / 2026 Statement of account",
    "items": [
      {
        "x": 437,
        "text": "From"
      },
      {
        "x": 551.5,
        "text": ":"
      },
      {
        "x": 751,
        "text": "01"
      },
      {
        "x": 751,
        "text": "/"
      },
      {
        "x": 751,
        "text": "04"
      },
      {
        "x": 751,
        "text": "/"
      },
      {
        "x": 751,
        "text": "2025"
      },
      {
        "x": 1444,
        "text": "To"
      },
      {
        "x": 1524.5,
        "text": ":"
      },
      {
        "x": 1725,
        "text": "31"
      },
      {
        "x": 1725,
        "text": "/"
      },
      {
        "x": 1725,
        "text": "03"
      },
      {
        "x": 1725,
        "text": "/"
      },
      {
        "x": 1725,
        "text": "2026"
      },
      {
        "x": 3227,
        "text": "Statement"
      },
      {
        "x": 3511.5,
        "text": "of"
      },
      {
        "x": 3746,
        "text": "account"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "01 / 05 / 25 UPI - NEXASPHERETECHNOLOGI - WEGO.NEXASPHERE 0000104082973513 01 / 05 / 25 500.00 9,090.34",
    "items": [
      {
        "x": 478.5,
        "text": "01"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "05"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "25"
      },
      {
        "x": 1497.5,
        "text": "UPI"
      },
      {
        "x": 1497.5,
        "text": "-"
      },
      {
        "x": 1497.5,
        "text": "NEXASPHERETECHNOLOGI"
      },
      {
        "x": 1497.5,
        "text": "-"
      },
      {
        "x": 1497.5,
        "text": "WEGO.NEXASPHERE"
      },
      {
        "x": 2853,
        "text": "0000104082973513"
      },
      {
        "x": 3337.5,
        "text": "01"
      },
      {
        "x": 3337.5,
        "text": "/"
      },
      {
        "x": 3337.5,
        "text": "05"
      },
      {
        "x": 3337.5,
        "text": "/"
      },
      {
        "x": 3337.5,
        "text": "25"
      },
      {
        "x": 4062,
        "text": "500.00"
      },
      {
        "x": 5401,
        "text": "9,090.34"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "TECHPVTLTD @ FINOBANK - FINO0000001 - 10408297",
    "items": [
      {
        "x": 1453,
        "text": "TECHPVTLTD"
      },
      {
        "x": 1453,
        "text": "@"
      },
      {
        "x": 1453,
        "text": "FINOBANK"
      },
      {
        "x": 1453,
        "text": "-"
      },
      {
        "x": 1453,
        "text": "FINO0000001"
      },
      {
        "x": 1453,
        "text": "-"
      },
      {
        "x": 1453,
        "text": "10408297"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "3513 - T3771329491746",
    "items": [
      {
        "x": 1018,
        "text": "3513"
      },
      {
        "x": 1018,
        "text": "-"
      },
      {
        "x": 1018,
        "text": "T3771329491746"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "500.00",
    "items": [
      {
        "x": 4062,
        "text": "500.00"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "01 / 05 / 25 UPI - TESLAQ 0000104085437434 01 / 05 / 25 8,590.34",
    "items": [
      {
        "x": 474,
        "text": "01"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "05"
      },
      {
        "x": 474,
        "text": "/"
      },
      {
        "x": 474,
        "text": "25"
      },
      {
        "x": 882,
        "text": "UPI"
      },
      {
        "x": 882,
        "text": "-"
      },
      {
        "x": 882,
        "text": "TESLAQ"
      },
      {
        "x": 2868.5,
        "text": "0000104085437434"
      },
      {
        "x": 3337.5,
        "text": "01"
      },
      {
        "x": 3337.5,
        "text": "/"
      },
      {
        "x": 3337.5,
        "text": "05"
      },
      {
        "x": 3337.5,
        "text": "/"
      },
      {
        "x": 3337.5,
        "text": "25"
      },
      {
        "x": 5395.5,
        "text": "8,590.34"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "INFOTECHNOLOG - WEGO.TESLAQINFO",
    "items": [
      {
        "x": 1285,
        "text": "INFOTECHNOLOG"
      },
      {
        "x": 1285,
        "text": "-"
      },
      {
        "x": 1285,
        "text": "WEGO.TESLAQINFO"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "PVTLTD @ FINOBANK - FINO0000001 - 104085437434",
    "items": [
      {
        "x": 1464.5,
        "text": "PVTLTD"
      },
      {
        "x": 1464.5,
        "text": "@"
      },
      {
        "x": 1464.5,
        "text": "FINOBANK"
      },
      {
        "x": 1464.5,
        "text": "-"
      },
      {
        "x": 1464.5,
        "text": "FINO0000001"
      },
      {
        "x": 1464.5,
        "text": "-"
      },
      {
        "x": 1464.5,
        "text": "104085437434"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "- T3771840511746",
    "items": [
      {
        "x": 953,
        "text": "-"
      },
      {
        "x": 953,
        "text": "T3771840511746"
      }
    ]
  },
  {
    "pageNumber": 2,
    "text": "1,000.00",
    "items": [
      {
        "x": 4714.5,
        "text": "1,000.00"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Page No .: 63",
    "items": [
      {
        "x": 2652.5,
        "text": "Page"
      },
      {
        "x": 2780.5,
        "text": "No"
      },
      {
        "x": 2857,
        "text": ".:"
      },
      {
        "x": 2929.5,
        "text": "63"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "- HDFC BANK",
    "items": [
      {
        "x": 505.5,
        "text": "-"
      },
      {
        "x": 788.5,
        "text": "HDFC"
      },
      {
        "x": 1268.5,
        "text": "BANK"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Account Branch : WADA",
    "items": [
      {
        "x": 3136.5,
        "text": "Account"
      },
      {
        "x": 3388.5,
        "text": "Branch"
      },
      {
        "x": 3530,
        "text": ":"
      },
      {
        "x": 3676,
        "text": "WADA"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "We understand your world",
    "items": [
      {
        "x": 390.5,
        "text": "We"
      },
      {
        "x": 765,
        "text": "understand"
      },
      {
        "x": 1171.5,
        "text": "your"
      },
      {
        "x": 1434,
        "text": "world"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Address : SHOP NO 113 114 ,",
    "items": [
      {
        "x": 3130,
        "text": "Address"
      },
      {
        "x": 3533.5,
        "text": ":"
      },
      {
        "x": 3654,
        "text": "SHOP"
      },
      {
        "x": 3812.5,
        "text": "NO"
      },
      {
        "x": 3932.5,
        "text": "113"
      },
      {
        "x": 4062.5,
        "text": "114"
      },
      {
        "x": 4062.5,
        "text": ","
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "NILKANTH APARTMENT , OPP BSNL OFFICE",
    "items": [
      {
        "x": 3746.5,
        "text": "NILKANTH"
      },
      {
        "x": 4170,
        "text": "APARTMENT"
      },
      {
        "x": 4170,
        "text": ","
      },
      {
        "x": 4474.5,
        "text": "OPP"
      },
      {
        "x": 4641.5,
        "text": "BSNL"
      },
      {
        "x": 4864.5,
        "text": "OFFICE"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "WADA MANOR ROAD",
    "items": [
      {
        "x": 3675,
        "text": "WADA"
      },
      {
        "x": 3931.5,
        "text": "MANOR"
      },
      {
        "x": 4176,
        "text": "ROAD"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "City : WADA 421303",
    "items": [
      {
        "x": 3086.5,
        "text": "City"
      },
      {
        "x": 3520,
        "text": ":"
      },
      {
        "x": 3670.5,
        "text": "WADA"
      },
      {
        "x": 3913.5,
        "text": "421303"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "MR VAIBHAV LAXMAN BHUSNAR",
    "items": [
      {
        "x": 408,
        "text": "MR"
      },
      {
        "x": 728.5,
        "text": "VAIBHAV"
      },
      {
        "x": 1057.5,
        "text": "LAXMAN"
      },
      {
        "x": 1396.5,
        "text": "BHUSNAR"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": ": MAHARASHTRA",
    "items": [
      {
        "x": 3806,
        "text": ":"
      },
      {
        "x": 3806,
        "text": "MAHARASHTRA"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "FLAT NO 102 B WING SAI DARSHAN APT",
    "items": [
      {
        "x": 438,
        "text": "FLAT"
      },
      {
        "x": 590.5,
        "text": "NO"
      },
      {
        "x": 710,
        "text": "102"
      },
      {
        "x": 805.5,
        "text": "B"
      },
      {
        "x": 938.5,
        "text": "WING"
      },
      {
        "x": 1106,
        "text": "SAI"
      },
      {
        "x": 1353.5,
        "text": "DARSHAN"
      },
      {
        "x": 1608,
        "text": "APT"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "18002600 / 18001600",
    "items": [
      {
        "x": 3844,
        "text": "18002600"
      },
      {
        "x": 3844,
        "text": "/"
      },
      {
        "x": 3844,
        "text": "18001600"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Phone no",
    "items": [
      {
        "x": 3105.5,
        "text": "Phone"
      },
      {
        "x": 3251.5,
        "text": "no"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": ": 0.00",
    "items": [
      {
        "x": 3526,
        "text": ":"
      },
      {
        "x": 3636.5,
        "text": "0.00"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "AT CHINCHGHAR PO KUDUS TAL WADA OD Limi",
    "items": [
      {
        "x": 400,
        "text": "AT"
      },
      {
        "x": 695.5,
        "text": "CHINCHGHAR"
      },
      {
        "x": 986.5,
        "text": "PO"
      },
      {
        "x": 1168,
        "text": "KUDUS"
      },
      {
        "x": 1372.5,
        "text": "TAL"
      },
      {
        "x": 1571,
        "text": "WADA"
      },
      {
        "x": 3071,
        "text": "OD"
      },
      {
        "x": 3212.5,
        "text": "Limi"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": ": INR",
    "items": [
      {
        "x": 3604,
        "text": ":"
      },
      {
        "x": 3604,
        "text": "INR"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "PALGHAR",
    "items": [
      {
        "x": 517,
        "text": "PALGHAR"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Curency",
    "items": [
      {
        "x": 3141,
        "text": "Curency"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": ": VAIBHABHUSNAR915 @ GMAIL.COM",
    "items": [
      {
        "x": 3533,
        "text": ":"
      },
      {
        "x": 4176,
        "text": "VAIBHABHUSNAR915"
      },
      {
        "x": 4176,
        "text": "@"
      },
      {
        "x": 4176,
        "text": "GMAIL.COM"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "KUDUS 421312 Cust ID",
    "items": [
      {
        "x": 471.5,
        "text": "KUDUS"
      },
      {
        "x": 716,
        "text": "421312"
      },
      {
        "x": 3083.5,
        "text": "Cust"
      },
      {
        "x": 3210.5,
        "text": "ID"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": ": 5010033913241 PRIME POTENTIAL",
    "items": [
      {
        "x": 3516.5,
        "text": ":"
      },
      {
        "x": 3819.5,
        "text": "5010033913241"
      },
      {
        "x": 4208,
        "text": "PRIME"
      },
      {
        "x": 4526.5,
        "text": "POTENTIAL"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "MAHARASHTRA INDIA",
    "items": [
      {
        "x": 619.5,
        "text": "MAHARASHTRA"
      },
      {
        "x": 1005,
        "text": "INDIA"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "JOINT HOLDERS :",
    "items": [
      {
        "x": 442,
        "text": "JOINT"
      },
      {
        "x": 745,
        "text": "HOLDERS"
      },
      {
        "x": 745,
        "text": ":"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "MICR : 400240161",
    "items": [
      {
        "x": 4299.5,
        "text": "MICR"
      },
      {
        "x": 4416.5,
        "text": ":"
      },
      {
        "x": 4598.5,
        "text": "400240161"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Branch Coc",
    "items": [
      {
        "x": 3139.5,
        "text": "Branch"
      },
      {
        "x": 3291,
        "text": "Coc"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Arcount yee : SAVINGS AC - RESIDENT 100 )",
    "items": [
      {
        "x": 3140,
        "text": "Arcount"
      },
      {
        "x": 3378.5,
        "text": "yee"
      },
      {
        "x": 3511,
        "text": ":"
      },
      {
        "x": 3705,
        "text": "SAVINGS"
      },
      {
        "x": 3961.5,
        "text": "AC"
      },
      {
        "x": 3961.5,
        "text": "-"
      },
      {
        "x": 4226,
        "text": "RESIDENT"
      },
      {
        "x": 4482,
        "text": "100"
      },
      {
        "x": 4482,
        "text": ")"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Nomination : Registered",
    "items": [
      {
        "x": 519.5,
        "text": "Nomination"
      },
      {
        "x": 715.5,
        "text": ":"
      },
      {
        "x": 904,
        "text": "Registered"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "From : 01 / 04 / 2025 To : 31 / 03 / 2026 Statement of account",
    "items": [
      {
        "x": 437,
        "text": "From"
      },
      {
        "x": 551.5,
        "text": ":"
      },
      {
        "x": 751,
        "text": "01"
      },
      {
        "x": 751,
        "text": "/"
      },
      {
        "x": 751,
        "text": "04"
      },
      {
        "x": 751,
        "text": "/"
      },
      {
        "x": 751,
        "text": "2025"
      },
      {
        "x": 1446,
        "text": "To"
      },
      {
        "x": 1526,
        "text": ":"
      },
      {
        "x": 1725,
        "text": "31"
      },
      {
        "x": 1725,
        "text": "/"
      },
      {
        "x": 1725,
        "text": "03"
      },
      {
        "x": 1725,
        "text": "/"
      },
      {
        "x": 1725,
        "text": "2026"
      },
      {
        "x": 3227,
        "text": "Statement"
      },
      {
        "x": 3511.5,
        "text": "of"
      },
      {
        "x": 3746,
        "text": "account"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "11 / 03 / 26 | UPI - RUPAM 0000119834168982 / / 11 03 26 510.00 22,982.89",
    "items": [
      {
        "x": 473.5,
        "text": "11"
      },
      {
        "x": 473.5,
        "text": "/"
      },
      {
        "x": 473.5,
        "text": "03"
      },
      {
        "x": 473.5,
        "text": "/"
      },
      {
        "x": 473.5,
        "text": "26"
      },
      {
        "x": 654,
        "text": "|"
      },
      {
        "x": 876,
        "text": "UPI"
      },
      {
        "x": 876,
        "text": "-"
      },
      {
        "x": 876,
        "text": "RUPAM"
      },
      {
        "x": 2853.5,
        "text": "0000119834168982"
      },
      {
        "x": 3348,
        "text": "/"
      },
      {
        "x": 3348,
        "text": "/"
      },
      {
        "x": 3348.5,
        "text": "11"
      },
      {
        "x": 3348.5,
        "text": "03"
      },
      {
        "x": 3348.5,
        "text": "26"
      },
      {
        "x": 4056.5,
        "text": "510.00"
      },
      {
        "x": 5384,
        "text": "22,982.89"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "PETROLEUM - 0392920586 @ YBL - YESBO",
    "items": [
      {
        "x": 1077,
        "text": "PETROLEUM"
      },
      {
        "x": 1077,
        "text": "-"
      },
      {
        "x": 1077,
        "text": "0392920586"
      },
      {
        "x": 1077,
        "text": "@"
      },
      {
        "x": 1713.5,
        "text": "YBL"
      },
      {
        "x": 1713.5,
        "text": "-"
      },
      {
        "x": 1713.5,
        "text": "YESBO"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "YBLUPI - 119834168982 - UPI",
    "items": [
      {
        "x": 1105,
        "text": "YBLUPI"
      },
      {
        "x": 1105,
        "text": "-"
      },
      {
        "x": 1105,
        "text": "119834168982"
      },
      {
        "x": 1105,
        "text": "-"
      },
      {
        "x": 1105,
        "text": "UPI"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "11 / 03 / 26 UPI - MAHAPE 11 / 03 / 26",
    "items": [
      {
        "x": 499.5,
        "text": "11"
      },
      {
        "x": 499.5,
        "text": "/"
      },
      {
        "x": 499.5,
        "text": "03"
      },
      {
        "x": 499.5,
        "text": "/"
      },
      {
        "x": 499.5,
        "text": "26"
      },
      {
        "x": 895.5,
        "text": "UPI"
      },
      {
        "x": 895.5,
        "text": "-"
      },
      {
        "x": 895.5,
        "text": "MAHAPE"
      },
      {
        "x": 3332.5,
        "text": "11"
      },
      {
        "x": 3332.5,
        "text": "/"
      },
      {
        "x": 3332.5,
        "text": "03"
      },
      {
        "x": 3332.5,
        "text": "/"
      },
      {
        "x": 3332.5,
        "text": "26"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "0000119859735394 1,010.00 21,972.89",
    "items": [
      {
        "x": 2847.5,
        "text": "0000119859735394"
      },
      {
        "x": 4029,
        "text": "1,010.00"
      },
      {
        "x": 5374,
        "text": "21,972.89"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "AUTOMOBILES - PAYTM - 46040825 @ PT",
    "items": [
      {
        "x": 1263,
        "text": "AUTOMOBILES"
      },
      {
        "x": 1263,
        "text": "-"
      },
      {
        "x": 1263,
        "text": "PAYTM"
      },
      {
        "x": 1263,
        "text": "-"
      },
      {
        "x": 1263,
        "text": "46040825"
      },
      {
        "x": 1263,
        "text": "@"
      },
      {
        "x": 1263,
        "text": "PT"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "YS - YESBOPTMUPI - 119859735394 - UPI",
    "items": [
      {
        "x": 1268.5,
        "text": "YS"
      },
      {
        "x": 1268.5,
        "text": "-"
      },
      {
        "x": 1268.5,
        "text": "YESBOPTMUPI"
      },
      {
        "x": 1268.5,
        "text": "-"
      },
      {
        "x": 1268.5,
        "text": "119859735394"
      },
      {
        "x": 1268.5,
        "text": "-"
      },
      {
        "x": 1268.5,
        "text": "UPI"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "13 / 03 / 26 UPI - BHAGYASHREE 0000013545332995 13 / 03 / 26 20,000.00 41,972.89",
    "items": [
      {
        "x": 478.5,
        "text": "13"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "03"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "26"
      },
      {
        "x": 986,
        "text": "UPI"
      },
      {
        "x": 986,
        "text": "-"
      },
      {
        "x": 986,
        "text": "BHAGYASHREE"
      },
      {
        "x": 2847.5,
        "text": "0000013545332995"
      },
      {
        "x": 3326,
        "text": "13"
      },
      {
        "x": 3326,
        "text": "/"
      },
      {
        "x": 3326,
        "text": "03"
      },
      {
        "x": 3326,
        "text": "/"
      },
      {
        "x": 3326,
        "text": "26"
      },
      {
        "x": 4699,
        "text": "20,000.00"
      },
      {
        "x": 5373.5,
        "text": "41,972.89"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "MOTORS - VAIBHAVBHUSNAR915",
    "items": [
      {
        "x": 1186.5,
        "text": "MOTORS"
      },
      {
        "x": 1186.5,
        "text": "-"
      },
      {
        "x": 1186.5,
        "text": "VAIBHAVBHUSNAR915"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "1 @ YBL - HDFC0002246 - 013545332995 - PAYMENT F",
    "items": [
      {
        "x": 1427.5,
        "text": "1"
      },
      {
        "x": 1427.5,
        "text": "@"
      },
      {
        "x": 1427.5,
        "text": "YBL"
      },
      {
        "x": 1427.5,
        "text": "-"
      },
      {
        "x": 1427.5,
        "text": "HDFC0002246"
      },
      {
        "x": 1427.5,
        "text": "-"
      },
      {
        "x": 1427.5,
        "text": "013545332995"
      },
      {
        "x": 1427.5,
        "text": "-"
      },
      {
        "x": 1427.5,
        "text": "PAYMENT"
      },
      {
        "x": 2216,
        "text": "F"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "ROM PHONE",
    "items": [
      {
        "x": 760.5,
        "text": "ROM"
      },
      {
        "x": 977,
        "text": "PHONE"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "15 / 03 / 26 CC 000517635XXXXXX7519 AUTOPAY SI - TAD 0000000730334439 15 / 03 / 26 23,890.80 18,082.09",
    "items": [
      {
        "x": 479,
        "text": "15"
      },
      {
        "x": 479,
        "text": "/"
      },
      {
        "x": 479,
        "text": "03"
      },
      {
        "x": 479,
        "text": "/"
      },
      {
        "x": 479,
        "text": "26"
      },
      {
        "x": 721,
        "text": "CC"
      },
      {
        "x": 1172.5,
        "text": "000517635XXXXXX7519"
      },
      {
        "x": 1734,
        "text": "AUTOPAY"
      },
      {
        "x": 2032.5,
        "text": "SI"
      },
      {
        "x": 2032.5,
        "text": "-"
      },
      {
        "x": 2032.5,
        "text": "TAD"
      },
      {
        "x": 2853,
        "text": "0000000730334439"
      },
      {
        "x": 3332,
        "text": "15"
      },
      {
        "x": 3332,
        "text": "/"
      },
      {
        "x": 3332,
        "text": "03"
      },
      {
        "x": 3332,
        "text": "/"
      },
      {
        "x": 3332,
        "text": "26"
      },
      {
        "x": 4012,
        "text": "23,890.80"
      },
      {
        "x": 5374,
        "text": "18,082.09"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "23 / 03 / 26 UPI - KRISHNA DAIRY AND 0000120456652680 23 / 03 / 26 20.00 18,062.09",
    "items": [
      {
        "x": 479,
        "text": "23"
      },
      {
        "x": 479,
        "text": "/"
      },
      {
        "x": 479,
        "text": "03"
      },
      {
        "x": 479,
        "text": "/"
      },
      {
        "x": 479,
        "text": "26"
      },
      {
        "x": 903,
        "text": "UPI"
      },
      {
        "x": 903,
        "text": "-"
      },
      {
        "x": 903,
        "text": "KRISHNA"
      },
      {
        "x": 1257,
        "text": "DAIRY"
      },
      {
        "x": 1464.5,
        "text": "AND"
      },
      {
        "x": 2853,
        "text": "0000120456652680"
      },
      {
        "x": 3337,
        "text": "23"
      },
      {
        "x": 3337,
        "text": "/"
      },
      {
        "x": 3337,
        "text": "03"
      },
      {
        "x": 3337,
        "text": "/"
      },
      {
        "x": 3337,
        "text": "26"
      },
      {
        "x": 4077.5,
        "text": "20.00"
      },
      {
        "x": 5378.5,
        "text": "18,062.09"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "SW - BHARATPE . 900641",
    "items": [
      {
        "x": 1012,
        "text": "SW"
      },
      {
        "x": 1012,
        "text": "-"
      },
      {
        "x": 1012,
        "text": "BHARATPE"
      },
      {
        "x": 1012,
        "text": "."
      },
      {
        "x": 1012,
        "text": "900641"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "74685 @ FBPE - FDRL0001382 - 120456652680 - PAY",
    "items": [
      {
        "x": 1410,
        "text": "74685"
      },
      {
        "x": 1410,
        "text": "@"
      },
      {
        "x": 1410,
        "text": "FBPE"
      },
      {
        "x": 1410,
        "text": "-"
      },
      {
        "x": 1410,
        "text": "FDRL0001382"
      },
      {
        "x": 1410,
        "text": "-"
      },
      {
        "x": 1410,
        "text": "120456652680"
      },
      {
        "x": 1410,
        "text": "-"
      },
      {
        "x": 1410,
        "text": "PAY"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "TO PRAKASH CHA",
    "items": [
      {
        "x": 729,
        "text": "TO"
      },
      {
        "x": 958.5,
        "text": "PRAKASH"
      },
      {
        "x": 1215,
        "text": "CHA"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "01 / 04 / 26 INTEREST PAID TILL 31 - MAR - 2026 000000000000000 31 / 03 / 26 298.00 18,360.09",
    "items": [
      {
        "x": 478.5,
        "text": "01"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "04"
      },
      {
        "x": 478.5,
        "text": "/"
      },
      {
        "x": 478.5,
        "text": "26"
      },
      {
        "x": 827.5,
        "text": "INTEREST"
      },
      {
        "x": 1116.5,
        "text": "PAID"
      },
      {
        "x": 1287.5,
        "text": "TILL"
      },
      {
        "x": 1590.5,
        "text": "31"
      },
      {
        "x": 1590.5,
        "text": "-"
      },
      {
        "x": 1590.5,
        "text": "MAR"
      },
      {
        "x": 1590.5,
        "text": "-"
      },
      {
        "x": 1590.5,
        "text": "2026"
      },
      {
        "x": 2858.5,
        "text": "000000000000000"
      },
      {
        "x": 3321.5,
        "text": "31"
      },
      {
        "x": 3321.5,
        "text": "/"
      },
      {
        "x": 3321.5,
        "text": "03"
      },
      {
        "x": 3321.5,
        "text": "/"
      },
      {
        "x": 3321.5,
        "text": "26"
      },
      {
        "x": 4742.5,
        "text": "298.00"
      },
      {
        "x": 5373.5,
        "text": "18,360.09"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "STATEMENT SUMMARY :-",
    "items": [
      {
        "x": 916.5,
        "text": "STATEMENT"
      },
      {
        "x": 1455,
        "text": "SUMMARY"
      },
      {
        "x": 1746.5,
        "text": ":-"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Dr Count Cr Count Debits Credits Closing Bal",
    "items": [
      {
        "x": 2610.5,
        "text": "Dr"
      },
      {
        "x": 2787,
        "text": "Count"
      },
      {
        "x": 3239,
        "text": "Cr"
      },
      {
        "x": 3404,
        "text": "Count"
      },
      {
        "x": 3838,
        "text": "Debits"
      },
      {
        "x": 4535,
        "text": "Credits"
      },
      {
        "x": 5146.5,
        "text": "Closing"
      },
      {
        "x": 5350,
        "text": "Bal"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Opening Balance",
    "items": [
      {
        "x": 1328.5,
        "text": "Opening"
      },
      {
        "x": 1606.5,
        "text": "Balance"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "105,594.14 586 111 2,993,226.40 2,905,992.35",
    "items": [
      {
        "x": 1459,
        "text": "105,594.14"
      },
      {
        "x": 2728,
        "text": "586"
      },
      {
        "x": 3343.5,
        "text": "111"
      },
      {
        "x": 3849,
        "text": "2,993,226.40"
      },
      {
        "x": 4541,
        "text": "2,905,992.35"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "18,360.09",
    "items": [
      {
        "x": 5210,
        "text": "18,360.09"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Generated On : 26 - May - 2026 17 : 34 Generated By : 137797587 Requesting Branch Code : NET",
    "items": [
      {
        "x": 924,
        "text": "Generated"
      },
      {
        "x": 1162.5,
        "text": "On"
      },
      {
        "x": 1162.5,
        "text": ":"
      },
      {
        "x": 1444,
        "text": "26"
      },
      {
        "x": 1444,
        "text": "-"
      },
      {
        "x": 1444,
        "text": "May"
      },
      {
        "x": 1444,
        "text": "-"
      },
      {
        "x": 1444,
        "text": "2026"
      },
      {
        "x": 1744.5,
        "text": "17"
      },
      {
        "x": 1744.5,
        "text": ":"
      },
      {
        "x": 1744.5,
        "text": "34"
      },
      {
        "x": 2499.5,
        "text": "Generated"
      },
      {
        "x": 2729.5,
        "text": "By"
      },
      {
        "x": 2729.5,
        "text": ":"
      },
      {
        "x": 2952,
        "text": "137797587"
      },
      {
        "x": 4062.5,
        "text": "Requesting"
      },
      {
        "x": 4365,
        "text": "Branch"
      },
      {
        "x": 4582.5,
        "text": "Code"
      },
      {
        "x": 4582.5,
        "text": ":"
      },
      {
        "x": 4759.5,
        "text": "NET"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "This is a computer generated statement and does",
    "items": [
      {
        "x": 4250,
        "text": "This"
      },
      {
        "x": 4367.5,
        "text": "is"
      },
      {
        "x": 4416.5,
        "text": "a"
      },
      {
        "x": 4582.5,
        "text": "computer"
      },
      {
        "x": 4872.5,
        "text": "generated"
      },
      {
        "x": 5155.5,
        "text": "statement"
      },
      {
        "x": 5359.5,
        "text": "and"
      },
      {
        "x": 5495.5,
        "text": "does"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "not require signature .",
    "items": [
      {
        "x": 4225,
        "text": "not"
      },
      {
        "x": 4397.5,
        "text": "require"
      },
      {
        "x": 4658.5,
        "text": "signature"
      },
      {
        "x": 4658.5,
        "text": "."
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "HDFC BANK LIMITED",
    "items": [
      {
        "x": 415,
        "text": "HDFC"
      },
      {
        "x": 655,
        "text": "BANK"
      },
      {
        "x": 964,
        "text": "LIMITED"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "* Closing balance includes funds earmarked for hold and uncleared funds",
    "items": [
      {
        "x": 422.5,
        "text": "*"
      },
      {
        "x": 422.5,
        "text": "Closing"
      },
      {
        "x": 670.5,
        "text": "balance"
      },
      {
        "x": 914,
        "text": "includes"
      },
      {
        "x": 1128,
        "text": "funds"
      },
      {
        "x": 1370.5,
        "text": "earmarked"
      },
      {
        "x": 1576,
        "text": "for"
      },
      {
        "x": 1694.5,
        "text": "hold"
      },
      {
        "x": 1828,
        "text": "and"
      },
      {
        "x": 2033,
        "text": "uncleared"
      },
      {
        "x": 2266.5,
        "text": "funds"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Contents of this statement will be considered correct if no error is reported within 30 days of receipt of statement . The address on this statement is that on record with the Bank as at the day of requesting",
    "items": [
      {
        "x": 408.5,
        "text": "Contents"
      },
      {
        "x": 556,
        "text": "of"
      },
      {
        "x": 636.5,
        "text": "this"
      },
      {
        "x": 818,
        "text": "statement"
      },
      {
        "x": 999.5,
        "text": "will"
      },
      {
        "x": 1089.5,
        "text": "be"
      },
      {
        "x": 1266.5,
        "text": "considered"
      },
      {
        "x": 1495,
        "text": "correct"
      },
      {
        "x": 1614,
        "text": "if"
      },
      {
        "x": 1680.5,
        "text": "no"
      },
      {
        "x": 1786,
        "text": "error"
      },
      {
        "x": 1881,
        "text": "is"
      },
      {
        "x": 2019,
        "text": "reported"
      },
      {
        "x": 2215,
        "text": "within"
      },
      {
        "x": 2338.5,
        "text": "30"
      },
      {
        "x": 2443,
        "text": "days"
      },
      {
        "x": 2539,
        "text": "of"
      },
      {
        "x": 2662.5,
        "text": "receipt"
      },
      {
        "x": 2787,
        "text": "of"
      },
      {
        "x": 2948.5,
        "text": "statement"
      },
      {
        "x": 2948.5,
        "text": "."
      },
      {
        "x": 3130,
        "text": "The"
      },
      {
        "x": 3277.5,
        "text": "address"
      },
      {
        "x": 3415.5,
        "text": "on"
      },
      {
        "x": 3506.5,
        "text": "this"
      },
      {
        "x": 3682,
        "text": "statement"
      },
      {
        "x": 3835,
        "text": "is"
      },
      {
        "x": 3920.5,
        "text": "that"
      },
      {
        "x": 4011.5,
        "text": "on"
      },
      {
        "x": 4136,
        "text": "record"
      },
      {
        "x": 4283.5,
        "text": "with"
      },
      {
        "x": 4388,
        "text": "the"
      },
      {
        "x": 4506.5,
        "text": "Bank"
      },
      {
        "x": 4611.5,
        "text": "as"
      },
      {
        "x": 4674,
        "text": "at"
      },
      {
        "x": 4745,
        "text": "the"
      },
      {
        "x": 4840.5,
        "text": "day"
      },
      {
        "x": 4926.5,
        "text": "of"
      },
      {
        "x": 5096,
        "text": "requesting"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "this statement .",
    "items": [
      {
        "x": 344.5,
        "text": "this"
      },
      {
        "x": 528,
        "text": "statement"
      },
      {
        "x": 528,
        "text": "."
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "State account branch GSTN : 27AAACH2702H1Z0",
    "items": [
      {
        "x": 367,
        "text": "State"
      },
      {
        "x": 551.5,
        "text": "account"
      },
      {
        "x": 761.5,
        "text": "branch"
      },
      {
        "x": 1244.5,
        "text": "GSTN"
      },
      {
        "x": 1244.5,
        "text": ":"
      },
      {
        "x": 1244.5,
        "text": "27AAACH2702H1Z0"
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "Horce once dies : dri an aise an hap apar has one areal ding paymems online tax paymen / goods - and - service - tax .",
    "items": [
      {
        "x": 416.5,
        "text": "Horce"
      },
      {
        "x": 655,
        "text": "once"
      },
      {
        "x": 864,
        "text": "dies"
      },
      {
        "x": 864,
        "text": ":"
      },
      {
        "x": 1074,
        "text": "dri"
      },
      {
        "x": 1217,
        "text": "an"
      },
      {
        "x": 1379,
        "text": "aise"
      },
      {
        "x": 1531.5,
        "text": "an"
      },
      {
        "x": 1636,
        "text": "hap"
      },
      {
        "x": 1789.5,
        "text": "apar"
      },
      {
        "x": 1950.5,
        "text": "has"
      },
      {
        "x": 2084.5,
        "text": "one"
      },
      {
        "x": 2332,
        "text": "areal"
      },
      {
        "x": 2598.5,
        "text": "ding"
      },
      {
        "x": 2799.5,
        "text": "paymems"
      },
      {
        "x": 3009.5,
        "text": "online"
      },
      {
        "x": 3142,
        "text": "tax"
      },
      {
        "x": 3598.5,
        "text": "paymen"
      },
      {
        "x": 3598.5,
        "text": "/"
      },
      {
        "x": 3598.5,
        "text": "goods"
      },
      {
        "x": 3598.5,
        "text": "-"
      },
      {
        "x": 3598.5,
        "text": "and"
      },
      {
        "x": 3598.5,
        "text": "-"
      },
      {
        "x": 3598.5,
        "text": "service"
      },
      {
        "x": 3598.5,
        "text": "-"
      },
      {
        "x": 3598.5,
        "text": "tax"
      },
      {
        "x": 3598.5,
        "text": "."
      }
    ]
  },
  {
    "pageNumber": 63,
    "text": "• Scanned with OKEN Scanner",
    "items": [
      {
        "x": 4902,
        "text": "•"
      },
      {
        "x": 5070,
        "text": "Scanned"
      },
      {
        "x": 5245.5,
        "text": "with"
      },
      {
        "x": 5375,
        "text": "OKEN"
      },
      {
        "x": 5546,
        "text": "Scanner"
      }
    ]
  }
];
