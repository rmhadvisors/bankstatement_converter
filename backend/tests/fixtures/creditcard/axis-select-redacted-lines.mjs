// Axis Bank "SELECT" credit card statement: every text line exactly as pdf.js extracts it, with the
// card holder's name and address, card digits, customer ID and payment reference replaced. Amounts,
// dates, merchants and layout are the real statement's. Page 3 (schedule of charges and worked
// interest examples printed after "End of Statement") is kept on purpose: none of its figures may
// reach the summary.
export const axisSelectLines = [
  {
    "pageNumber": 1,
    "y": 1020,
    "text": "SELECT credit card Statement",
    "items": [
      {
        "x": 313.5,
        "text": "SELECT credit card Statement"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 985,
    "text": "RAVI SHARMA",
    "items": [
      {
        "x": 31,
        "text": "RAVI"
      },
      {
        "x": 75.1,
        "text": "SHARMA"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 972,
    "text": "1 TEST HOUSING SOCIETY,",
    "items": [
      {
        "x": 31,
        "text": "1 TEST HOUSING SOCIETY,"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 964,
    "text": "TEST ROAD,TEST NAGAR,",
    "items": [
      {
        "x": 31,
        "text": "TEST ROAD,TEST NAGAR,"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 956,
    "text": "TESTPUR,",
    "items": [
      {
        "x": 31,
        "text": "TESTPUR,"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 948,
    "text": "MUMBAI 400001",
    "items": [
      {
        "x": 31,
        "text": "MUMBAI 400001"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 870,
    "text": "PAYMENT SUMMARY",
    "items": [
      {
        "x": 252,
        "text": "PAYMENT SUMMARY"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 856,
    "text": "Total Payment Due Minimum Payment Due Statement Period Payment Due Date Statement Generation Date",
    "items": [
      {
        "x": 51.5,
        "text": "Total Payment Due"
      },
      {
        "x": 151.5,
        "text": "Minimum Payment Due"
      },
      {
        "x": 271.5,
        "text": "Statement Period"
      },
      {
        "x": 381,
        "text": "Payment Due Date"
      },
      {
        "x": 472,
        "text": "Statement Generation Date"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 843,
    "text": "73,199.84 Dr 5,642.00 Dr 15/05/2026 - 13/06/2026 03/07/2026 13/06/2026",
    "items": [
      {
        "x": 60,
        "text": "73,199.84"
      },
      {
        "x": 98.1,
        "text": "Dr"
      },
      {
        "x": 170,
        "text": "5,642.00"
      },
      {
        "x": 204.1,
        "text": "Dr"
      },
      {
        "x": 259.5,
        "text": "15/05/2026 - 13/06/2026"
      },
      {
        "x": 393,
        "text": "03/07/2026"
      },
      {
        "x": 510,
        "text": "13/06/2026"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 827,
    "text": "Credit Card Number Credit Limit Available Credit Limit Available Cash Limit",
    "items": [
      {
        "x": 50.5,
        "text": "Credit Card Number"
      },
      {
        "x": 172,
        "text": "Credit Limit"
      },
      {
        "x": 265,
        "text": "Available Credit Limit"
      },
      {
        "x": 379,
        "text": "Available Cash Limit"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 823,
    "text": "For hassle free payments register for",
    "items": [
      {
        "x": 486,
        "text": "For hassle free payments register for"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 814,
    "text": "400000******1111 383,000.00 309,800.16 10,300.00 Auto-Debit facility on 18605005555",
    "items": [
      {
        "x": 51,
        "text": "400000******1111"
      },
      {
        "x": 173,
        "text": "383,000.00"
      },
      {
        "x": 282.5,
        "text": "309,800.16"
      },
      {
        "x": 396,
        "text": "10,300.00"
      },
      {
        "x": 487,
        "text": "Auto-Debit facility on 18605005555"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 799,
    "text": "Previous Balance - Payments - Credits + Purchase + Cash Advance + Other Debit&Charges =Total Payment Due Making only the minimum payment every",
    "items": [
      {
        "x": 68.5,
        "text": "Previous Balance - Payments - Credits + Purchase + Cash Advance + Other Debit&Charges =Total Payment Due"
      },
      {
        "x": 479,
        "text": "Making only the minimum payment every"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 793,
    "text": "month would result in the repayment stretching",
    "items": [
      {
        "x": 473,
        "text": "month would result in the repayment stretching"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 785,
    "text": "189,723.02 Dr 194,242.28 3,096.69 73,281.55 0.00 7,534.24 73,199.84 Dr over years with consequent interest payment",
    "items": [
      {
        "x": 44,
        "text": "189,723.02 Dr"
      },
      {
        "x": 112,
        "text": "194,242.28"
      },
      {
        "x": 164.5,
        "text": "3,096.69"
      },
      {
        "x": 209,
        "text": "73,281.55"
      },
      {
        "x": 273,
        "text": "0.00"
      },
      {
        "x": 335.5,
        "text": "7,534.24"
      },
      {
        "x": 404,
        "text": "73,199.84"
      },
      {
        "x": 442.1,
        "text": "Dr"
      },
      {
        "x": 475.5,
        "text": "over years with consequent interest payment"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 773,
    "text": "Account Summary",
    "items": [
      {
        "x": 271.5,
        "text": "Account Summary"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 762,
    "text": "DATE TRANSACTION DETAILS MERCHANT CATEGORY AMOUNT (Rs.)",
    "items": [
      {
        "x": 49.5,
        "text": "DATE"
      },
      {
        "x": 183.5,
        "text": "TRANSACTION DETAILS"
      },
      {
        "x": 386.5,
        "text": "MERCHANT CATEGORY"
      },
      {
        "x": 514,
        "text": "AMOUNT (Rs.)"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 752,
    "text": "Card No: 400000******1111 Name RAVI SHARMA",
    "items": [
      {
        "x": 83.3,
        "text": "Card No:"
      },
      {
        "x": 122,
        "text": "400000******1111"
      },
      {
        "x": 260,
        "text": "Name"
      },
      {
        "x": 287,
        "text": "RAVI SHARMA"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 741,
    "text": "25/05/2026 PAYPAL *VOICESFDYFW,4029357733 EDUCATION 5,054.31 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "25/05/2026"
      },
      {
        "x": 90.3,
        "text": "PAYPAL *VOICESFDYFW,4029357733"
      },
      {
        "x": 360.3,
        "text": "EDUCATION"
      },
      {
        "x": 544,
        "text": "5,054.31 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 731,
    "text": "25/05/2026 PAYPAL *FJPUBLICATI,4029357733 MISCELLANEOUS 2,527.16 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "25/05/2026"
      },
      {
        "x": 90.3,
        "text": "PAYPAL *FJPUBLICATI,4029357733"
      },
      {
        "x": 360.3,
        "text": "MISCELLANEOUS"
      },
      {
        "x": 544,
        "text": "2,527.16 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 721,
    "text": "26/05/2026 AVENUE SUPERMARTS LTD,THANE DEPT STORES 4,519.26 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "26/05/2026"
      },
      {
        "x": 90.3,
        "text": "AVENUE SUPERMARTS LTD,THANE"
      },
      {
        "x": 360.3,
        "text": "DEPT STORES"
      },
      {
        "x": 544,
        "text": "4,519.26 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 711,
    "text": "28/05/2026 DCC MARKUP 37.91 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "28/05/2026"
      },
      {
        "x": 90.3,
        "text": "DCC MARKUP"
      },
      {
        "x": 554,
        "text": "37.91 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 701,
    "text": "28/05/2026 GST 13.65 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "28/05/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 554,
        "text": "13.65 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 691,
    "text": "28/05/2026 DCC MARKUP 75.82 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "28/05/2026"
      },
      {
        "x": 90.3,
        "text": "DCC MARKUP"
      },
      {
        "x": 554,
        "text": "75.82 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 681,
    "text": "28/05/2026 MB PAYMENT #T0000000000001 194,242.28 Cr",
    "items": [
      {
        "x": 35.3,
        "text": "28/05/2026"
      },
      {
        "x": 90.3,
        "text": "MB PAYMENT #T0000000000001"
      },
      {
        "x": 537,
        "text": "194,242.28 Cr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 671,
    "text": "28/05/2026 GST 6.82 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "28/05/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 558,
        "text": "6.82 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 661,
    "text": "28/05/2026 FASHION FACTORY,MUMBAI CLOTH STORES 5,878.60 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "28/05/2026"
      },
      {
        "x": 90.3,
        "text": "FASHION FACTORY,MUMBAI"
      },
      {
        "x": 360.3,
        "text": "CLOTH STORES"
      },
      {
        "x": 544,
        "text": "5,878.60 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 651,
    "text": "31/05/2026 VEERA PETROLIUM,MUMBAI FUEL 3,541.30 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "31/05/2026"
      },
      {
        "x": 90.3,
        "text": "VEERA PETROLIUM,MUMBAI"
      },
      {
        "x": 360.3,
        "text": "FUEL"
      },
      {
        "x": 544,
        "text": "3,541.30 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 641,
    "text": "31/05/2026 FASHION FACTORY,MUMBAI CLOTH STORES 8,400.50 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "31/05/2026"
      },
      {
        "x": 90.3,
        "text": "FASHION FACTORY,MUMBAI"
      },
      {
        "x": 360.3,
        "text": "CLOTH STORES"
      },
      {
        "x": 544,
        "text": "8,400.50 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 631,
    "text": "31/05/2026 PAYPAL *MARYSA,4029357733 MISCELLANEOUS 1,506.98 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "31/05/2026"
      },
      {
        "x": 90.3,
        "text": "PAYPAL *MARYSA,4029357733"
      },
      {
        "x": 360.3,
        "text": "MISCELLANEOUS"
      },
      {
        "x": 544,
        "text": "1,506.98 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 621,
    "text": "31/05/2026 PAYPAL *DRODROJ17,4029357733 MISCELLANEOUS 1,761.49 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "31/05/2026"
      },
      {
        "x": 90.3,
        "text": "PAYPAL *DRODROJ17,4029357733"
      },
      {
        "x": 360.3,
        "text": "MISCELLANEOUS"
      },
      {
        "x": 544,
        "text": "1,761.49 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 611,
    "text": "01/06/2026 FUEL CASHBACK REBATES 35.02 Cr",
    "items": [
      {
        "x": 35.3,
        "text": "01/06/2026"
      },
      {
        "x": 90.3,
        "text": "FUEL CASHBACK REBATES"
      },
      {
        "x": 555,
        "text": "35.02 Cr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 601,
    "text": "01/06/2026 PAYPAL *MC,4029357733 MISCELLANEOUS 1,004.30 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "01/06/2026"
      },
      {
        "x": 90.3,
        "text": "PAYPAL *MC,4029357733"
      },
      {
        "x": 360.3,
        "text": "MISCELLANEOUS"
      },
      {
        "x": 544,
        "text": "1,004.30 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 591,
    "text": "03/06/2026 DCC MARKUP 22.61 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "DCC MARKUP"
      },
      {
        "x": 554,
        "text": "22.61 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 581,
    "text": "03/06/2026 GST 4.07 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 558,
        "text": "4.07 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 571,
    "text": "03/06/2026 PRIORITY PASS VISIT FEES GST 463.22 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "PRIORITY PASS VISIT FEES GST"
      },
      {
        "x": 550,
        "text": "463.22 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 561,
    "text": "03/06/2026 PRIORITY PASS VISIT FEES 2,573.43 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "PRIORITY PASS VISIT FEES"
      },
      {
        "x": 544,
        "text": "2,573.43 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 551,
    "text": "03/06/2026 GST 2.71 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 558,
        "text": "2.71 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 541,
    "text": "03/06/2026 DCC MARKUP 15.07 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "DCC MARKUP"
      },
      {
        "x": 554,
        "text": "15.07 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 531,
    "text": "03/06/2026 GST 4.76 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 558,
        "text": "4.76 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 521,
    "text": "03/06/2026 DCC MARKUP 26.42 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "03/06/2026"
      },
      {
        "x": 90.3,
        "text": "DCC MARKUP"
      },
      {
        "x": 554,
        "text": "26.42 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 511,
    "text": "04/06/2026 PP LOUNGE VISIT REVERSAL 2,573.43 Cr",
    "items": [
      {
        "x": 35.3,
        "text": "04/06/2026"
      },
      {
        "x": 90.3,
        "text": "PP LOUNGE VISIT REVERSAL"
      },
      {
        "x": 545,
        "text": "2,573.43 Cr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 501,
    "text": "04/06/2026 PP LOUNGE VISIT GST REVERSAL 463.22 Cr",
    "items": [
      {
        "x": 35.3,
        "text": "04/06/2026"
      },
      {
        "x": 90.3,
        "text": "PP LOUNGE VISIT GST REVERSAL"
      },
      {
        "x": 551,
        "text": "463.22 Cr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 491,
    "text": "07/06/2026 MAHARAJA BHOG,MUMBAI RESTAURANTS 4,457.00 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "07/06/2026"
      },
      {
        "x": 90.3,
        "text": "MAHARAJA BHOG,MUMBAI"
      },
      {
        "x": 360.3,
        "text": "RESTAURANTS"
      },
      {
        "x": 544,
        "text": "4,457.00 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 481,
    "text": "07/06/2026 BEST UNITED INDIA COMF,MUMBAI CLOTH STORES 7,695.01 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "07/06/2026"
      },
      {
        "x": 90.3,
        "text": "BEST UNITED INDIA COMF,MUMBAI"
      },
      {
        "x": 360.3,
        "text": "CLOTH STORES"
      },
      {
        "x": 544,
        "text": "7,695.01 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 471,
    "text": "08/06/2026 PAYPAL *NECONNECTED,35314369001 MISC STORE 24,406.14 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "08/06/2026"
      },
      {
        "x": 90.3,
        "text": "PAYPAL *NECONNECTED,35314369001"
      },
      {
        "x": 360.3,
        "text": "MISC STORE"
      },
      {
        "x": 540,
        "text": "24,406.14 Dr"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 437,
    "text": "Your cheque should be payable to Axis Bank Card No.400000******1111 . Please write your NAME & TELEPHONE No. on the reverse of the cheque.",
    "items": [
      {
        "x": 70,
        "text": "Your cheque should be payable to Axis Bank Card No.400000******1111 . Please write your NAME & TELEPHONE No. on the reverse of the cheque."
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 429,
    "text": "Dear Customer, pay your Axis Bank Credit Card bill from any bank account by registering for ECS at any Axis Bank branch. Visit axis.bank.in to download the form.",
    "items": [
      {
        "x": 70,
        "text": "Dear Customer, pay your Axis Bank Credit Card bill from any bank account by registering for ECS at any Axis Bank branch. Visit axis.bank.in to download the form."
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 421,
    "text": "Axis Bank Maharashtra GST registration no.: 27AAACU2414K3ZD.",
    "items": [
      {
        "x": 70,
        "text": "Axis Bank Maharashtra GST registration no.: 27AAACU2414K3ZD."
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 404,
    "text": "IMPORTANT MESSAGE",
    "items": [
      {
        "x": 33,
        "text": "IMPORTANT MESSAGE"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 397,
    "text": "* Axis Bank GST registration no.:27AAACU2414K3ZD * GST will be applicable on all fee, charges, interest and other changes as per prevailing provisions under the GST Act. HSN code: 997113. For State name/ Place of Supply, GST code",
    "items": [
      {
        "x": 33,
        "text": "* Axis Bank GST registration no.:27AAACU2414K3ZD * GST will be applicable on all fee, charges, interest and other changes as per prevailing provisions under the GST Act. HSN code: 997113. For State name/ Place of Supply, GST code"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 390,
    "text": "visit axis.bank.in/GSTstatecodelist * Make credit card bill payment by visiting axis.bank.in/ccpay * In case you have shifted from the address updated in bank records, we request to update the Aadhar-based address via IB/MB. * If",
    "items": [
      {
        "x": 33,
        "text": "visit axis.bank.in/GSTstatecodelist * Make credit card bill payment by visiting axis.bank.in/ccpay * In case you have shifted from the address updated in bank records, we request to update the Aadhar-based address via IB/MB. * If"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 383,
    "text": "there is an excess credit balance on the card, please raise an SR for refund through Customer Service. * In case of any default by the Cardholder, the Bank may exercise its right to lien and set off the outstanding amount against any",
    "items": [
      {
        "x": 33,
        "text": "there is an excess credit balance on the card, please raise an SR for refund through Customer Service. * In case of any default by the Cardholder, the Bank may exercise its right to lien and set off the outstanding amount against any"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 376,
    "text": "deposits or accounts held in the Cardholder’s name. * In line with RBI guidelines, Axis Bank’s official website and digital services are now available on the secure .bank.in domain * Overdue EMIs on your OTL (Over the Limit) Instant Loan",
    "items": [
      {
        "x": 33,
        "text": "deposits or accounts held in the Cardholder’s name. * In line with RBI guidelines, Axis Bank’s official website and digital services are now available on the secure .bank.in domain * Overdue EMIs on your OTL (Over the Limit) Instant Loan"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 369,
    "text": "will not attract finance /interest charges as mentioned in MITC. For more information, please refer to the MITC",
    "items": [
      {
        "x": 33,
        "text": "will not attract finance /interest charges as mentioned in MITC. For more information, please refer to the MITC"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 360,
    "text": "CONTACT US",
    "items": [
      {
        "x": 357.4,
        "text": "CONTACT US"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 351,
    "text": "Call 1860 419 5555 or 1860 500 5555 Grievance Redressal",
    "items": [
      {
        "x": 222,
        "text": "Call 1860 419 5555 or 1860 500 5555"
      },
      {
        "x": 379,
        "text": "Grievance Redressal"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 342,
    "text": "*local charges will apply Nodal Officer,",
    "items": [
      {
        "x": 222,
        "text": "*local charges will apply"
      },
      {
        "x": 379,
        "text": "Nodal Officer,"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 331,
    "text": "For any assistance please visit axis.bank.in/support 080 61865200",
    "items": [
      {
        "x": 222,
        "text": "For any assistance please visit axis.bank.in/support"
      },
      {
        "x": 379,
        "text": "080 61865200"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 326,
    "text": "eDGE REWARD BALANCE AS",
    "items": [
      {
        "x": 43,
        "text": "eDGE REWARD"
      },
      {
        "x": 111.5,
        "text": "BALANCE AS"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 323,
    "text": "CUSTOMER ID Manager, Customer Care,Axis Bank Ltd, CPU 1st Floor, nodal.officer@axis.bank.in",
    "items": [
      {
        "x": 164,
        "text": "CUSTOMER ID"
      },
      {
        "x": 222,
        "text": "Manager, Customer Care,Axis Bank Ltd, CPU 1st Floor,"
      },
      {
        "x": 379,
        "text": "nodal.officer@axis.bank.in"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 318,
    "text": "POINTS ON DATE",
    "items": [
      {
        "x": 56.5,
        "text": "POINTS"
      },
      {
        "x": 117,
        "text": "ON DATE"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 313,
    "text": "\"Gigaplex\", Plot No I.T.5, MIDC, Airoli Knowledge Park, Airoli Axis Bank Ltd, CPU 1st Floor, \"Gigaplex\", Plot No I.T.5, MIDC, Airoli Knowledge",
    "items": [
      {
        "x": 222,
        "text": "\"Gigaplex\", Plot No I.T.5, MIDC, Airoli Knowledge Park, Airoli"
      },
      {
        "x": 379,
        "text": "Axis Bank Ltd, CPU 1st Floor, \"Gigaplex\", Plot No I.T.5, MIDC, Airoli Knowledge"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 303,
    "text": "110210 11-06-2026 100000000 Navi Mumbai-400708 Park, Airoli, Navi Mumbai- 400708",
    "items": [
      {
        "x": 56.5,
        "text": "110210"
      },
      {
        "x": 114,
        "text": "11-06-2026"
      },
      {
        "x": 169.5,
        "text": "100000000"
      },
      {
        "x": 222,
        "text": "Navi Mumbai-400708"
      },
      {
        "x": 379,
        "text": "Park, Airoli, Navi Mumbai- 400708"
      }
    ]
  },
  {
    "pageNumber": 1,
    "y": 7,
    "text": "Page : 1 of 3",
    "items": [
      {
        "x": 534,
        "text": "Page : 1 of 3"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 1020,
    "text": "SELECT credit card Statement",
    "items": [
      {
        "x": 313.5,
        "text": "SELECT credit card Statement"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 1001,
    "text": "DATE TRANSACTION DETAILS MERCHANT CATEGORY AMOUNT (Rs.)",
    "items": [
      {
        "x": 49.5,
        "text": "DATE"
      },
      {
        "x": 183.5,
        "text": "TRANSACTION DETAILS"
      },
      {
        "x": 386.5,
        "text": "MERCHANT CATEGORY"
      },
      {
        "x": 514,
        "text": "AMOUNT (Rs.)"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 990,
    "text": "11/06/2026 DCC MARKUP 366.09 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "11/06/2026"
      },
      {
        "x": 90.3,
        "text": "DCC MARKUP"
      },
      {
        "x": 550,
        "text": "366.09 Dr"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 980,
    "text": "11/06/2026 GST 65.90 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "11/06/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 554,
        "text": "65.90 Dr"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 970,
    "text": "12/06/2026 VEERA PETROLIUM,MUMBAI FUEL 2,529.50 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "12/06/2026"
      },
      {
        "x": 90.3,
        "text": "VEERA PETROLIUM,MUMBAI"
      },
      {
        "x": 360.3,
        "text": "FUEL"
      },
      {
        "x": 544,
        "text": "2,529.50 Dr"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 960,
    "text": "13/06/2026 GST 588.17 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "13/06/2026"
      },
      {
        "x": 90.3,
        "text": "GST"
      },
      {
        "x": 550,
        "text": "588.17 Dr"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 950,
    "text": "13/06/2026 DEBIT INTEREST 3,267.59 Dr",
    "items": [
      {
        "x": 35.3,
        "text": "13/06/2026"
      },
      {
        "x": 90.3,
        "text": "DEBIT INTEREST"
      },
      {
        "x": 544,
        "text": "3,267.59 Dr"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 940,
    "text": "13/06/2026 FUEL CASHBACK REBATES 25.02 Cr",
    "items": [
      {
        "x": 35.3,
        "text": "13/06/2026"
      },
      {
        "x": 90.3,
        "text": "FUEL CASHBACK REBATES"
      },
      {
        "x": 555,
        "text": "25.02 Cr"
      }
    ]
  },
  {
    "pageNumber": 2,
    "y": 926,
    "text": "**** End of Statement ****",
    "items": [
      {
        "x": 253.5,
        "text": "**** End of Statement ****"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 1020,
    "text": "SELECT credit card Statement",
    "items": [
      {
        "x": 313.5,
        "text": "SELECT credit card Statement"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 995,
    "text": "Schedule of charges",
    "items": [
      {
        "x": 329,
        "text": "Schedule of charges"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 992,
    "text": "Finance Charge calculation",
    "items": [
      {
        "x": 43,
        "text": "Finance Charge calculation"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 979,
    "text": "If a card holder avails of the revolving facility of the credit card and hence chooses to Particulars Charges",
    "items": [
      {
        "x": 36,
        "text": "If a card holder avails of the revolving facility of the credit card and hence chooses to"
      },
      {
        "x": 324,
        "text": "Particulars"
      },
      {
        "x": 448,
        "text": "Charges"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 970,
    "text": "pay amount less than the total amount due reflected in the monthly billing",
    "items": [
      {
        "x": 36,
        "text": "pay"
      },
      {
        "x": 53.1,
        "text": "amount"
      },
      {
        "x": 83.2,
        "text": "less"
      },
      {
        "x": 100.3,
        "text": "than"
      },
      {
        "x": 120.3,
        "text": "the"
      },
      {
        "x": 136.4,
        "text": "total"
      },
      {
        "x": 157.5,
        "text": "amount"
      },
      {
        "x": 187.6,
        "text": "due"
      },
      {
        "x": 204.7,
        "text": "reflected"
      },
      {
        "x": 238.8,
        "text": "in"
      },
      {
        "x": 249.8,
        "text": "the"
      },
      {
        "x": 265.9,
        "text": "monthly"
      },
      {
        "x": 298,
        "text": "billing"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 962,
    "text": "statement. The entire outstanding amount would attract finance charges and all new Duplicate Statement Fee Waived",
    "items": [
      {
        "x": 36,
        "text": "statement. The entire outstanding amount would attract finance charges and all new"
      },
      {
        "x": 324,
        "text": "Duplicate Statement Fee"
      },
      {
        "x": 448,
        "text": "Waived"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 954,
    "text": "transactions will also attract finance charges, till such time as the previous",
    "items": [
      {
        "x": 36,
        "text": "transactions"
      },
      {
        "x": 81.5,
        "text": "will"
      },
      {
        "x": 98.9,
        "text": "also"
      },
      {
        "x": 117.4,
        "text": "attract"
      },
      {
        "x": 145.8,
        "text": "finance"
      },
      {
        "x": 174.3,
        "text": "charges,"
      },
      {
        "x": 206.7,
        "text": "till"
      },
      {
        "x": 221.2,
        "text": "such"
      },
      {
        "x": 240.6,
        "text": "time"
      },
      {
        "x": 261.1,
        "text": "as"
      },
      {
        "x": 273.5,
        "text": "the"
      },
      {
        "x": 290,
        "text": "previous"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 950,
    "text": "Charge slip retrieval Fee Waived",
    "items": [
      {
        "x": 324,
        "text": "Charge slip retrieval Fee"
      },
      {
        "x": 448,
        "text": "Waived"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 946,
    "text": "outstanding amount is paid in full. For example, assume that you have paid all",
    "items": [
      {
        "x": 36,
        "text": "outstanding amount is paid in full. For example, assume that you have paid all"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 937,
    "text": "previous dues in full and do not have any amount outstanding in your credit card Outstation Cheque Fee Waived",
    "items": [
      {
        "x": 36,
        "text": "previous dues in full and do not have any amount outstanding in your credit card"
      },
      {
        "x": 324,
        "text": "Outstation Cheque Fee"
      },
      {
        "x": 448,
        "text": "Waived"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 930,
    "text": "account. You have purchased household goods for Rs. 25000.00 on 12th June and",
    "items": [
      {
        "x": 36,
        "text": "account. You have purchased household goods for Rs. 25000.00 on 12th June and"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 923,
    "text": "withdrawn cash from ATM for Rs. 5000.00 on 15th June. Your monthly statement is on Finance Charges(Retail & Cash) 3.75% p.m. (55.55% per annum)",
    "items": [
      {
        "x": 36,
        "text": "withdrawn cash from ATM for Rs. 5000.00 on 15th June. Your monthly statement is on"
      },
      {
        "x": 324,
        "text": "Finance Charges(Retail & Cash)"
      },
      {
        "x": 448,
        "text": "3.75% p.m. (55.55% per annum)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 912,
    "text": "20th of every month. On 20th June, you would be levied interest on Rs. 5000.00 cash Fee for Cash Payment at branches Rs. 175",
    "items": [
      {
        "x": 36,
        "text": "20th of every month. On 20th June, you would be levied interest on Rs. 5000.00 cash"
      },
      {
        "x": 324,
        "text": "Fee for Cash Payment at branches"
      },
      {
        "x": 448,
        "text": "Rs. 175"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 906,
    "text": "withdrawals for 6 days @ 3.75% p.m. (effective 20th Dec’24) i.e., 5000.00*6",
    "items": [
      {
        "x": 36,
        "text": "withdrawals"
      },
      {
        "x": 82.2,
        "text": "for"
      },
      {
        "x": 96.4,
        "text": "6"
      },
      {
        "x": 105.5,
        "text": "days"
      },
      {
        "x": 125.7,
        "text": "@"
      },
      {
        "x": 137.9,
        "text": "3.75%"
      },
      {
        "x": 163.1,
        "text": "p.m."
      },
      {
        "x": 182.3,
        "text": "(effective"
      },
      {
        "x": 217.5,
        "text": "20th"
      },
      {
        "x": 237.6,
        "text": "Dec’24)"
      },
      {
        "x": 266.8,
        "text": "i.e.,"
      },
      {
        "x": 284,
        "text": "5000.00*6"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 899,
    "text": "days*3.75%*12 months/365days= Rs.36.99 your due date for 20th June statement is Cash Withdrawal Fees 2.5% of cash withdrawn (Min. Rs 500)",
    "items": [
      {
        "x": 36,
        "text": "days*3.75%*12 months/365days= Rs.36.99 your due date for 20th June statement is"
      },
      {
        "x": 324,
        "text": "Cash Withdrawal Fees"
      },
      {
        "x": 448,
        "text": "2.5% of cash withdrawn (Min. Rs 500)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 891,
    "text": "10th July and you pay Rs. 20000.00 on 10th July and you also make a fresh purchase (NA for digital cards)",
    "items": [
      {
        "x": 36,
        "text": "10th July and you pay Rs. 20000.00 on 10th July and you also make a fresh purchase"
      },
      {
        "x": 448,
        "text": "(NA for digital cards)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 882,
    "text": "of Rs. 10000.00 on 11th July, Interest to be levied on 20th July would be as under:",
    "items": [
      {
        "x": 36,
        "text": "of Rs. 10000.00 on 11th July, Interest to be levied on 20th July would be as under:"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 865,
    "text": "Nil if total payment due is upto Rs 500;",
    "items": [
      {
        "x": 448,
        "text": "Nil if total payment due is upto Rs 500;"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 857,
    "text": "Rs 500 if total payment due is between",
    "items": [
      {
        "x": 448,
        "text": "Rs 500 if total payment due is between"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 848,
    "text": "Interest on Rs. 25,000 @ 3.75% p.m. from 12th June to 11th July (30 Rs 501 - Rs 5000;",
    "items": [
      {
        "x": 38,
        "text": "Interest on Rs. 25,000 @ 3.75% p.m. from 12th June to 11th July (30"
      },
      {
        "x": 448,
        "text": "Rs 501 - Rs 5000;"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 844,
    "text": "924.66",
    "items": [
      {
        "x": 288,
        "text": "924.66"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 840,
    "text": "Days) Rs 750 if total payment due is between",
    "items": [
      {
        "x": 38,
        "text": "Days)"
      },
      {
        "x": 448,
        "text": "Rs 750 if total payment due is between"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 832,
    "text": "Interest on Rs. INR 5,000 @ 3.75% p.m. from 21st June to 11th July Rs 5001-Rs 10.000;",
    "items": [
      {
        "x": 38,
        "text": "Interest on Rs. INR 5,000 @ 3.75% p.m. from 21st June to 11th July"
      },
      {
        "x": 448,
        "text": "Rs 5001-Rs 10.000;"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 825,
    "text": "(21 days) 129.45 Overdue Penalty/late payment fee Rs 1,200 if total payment due is greater",
    "items": [
      {
        "x": 38,
        "text": "(21 days)"
      },
      {
        "x": 288,
        "text": "129.45"
      },
      {
        "x": 324,
        "text": "Overdue Penalty/late payment fee"
      },
      {
        "x": 448,
        "text": "Rs 1,200 if total payment due is greater"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 815,
    "text": "Interest on Rs. 36.99 (Interest levied in last statement) @ 3.75% p.m. than Rs. 10,000",
    "items": [
      {
        "x": 38,
        "text": "Interest on Rs. 36.99 (Interest levied in last statement) @ 3.75% p.m."
      },
      {
        "x": 448,
        "text": "than Rs. 10,000"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 808,
    "text": "from 20th June to 11th July (22 days). 1.00 *(An additional charge of Rs.100 will be",
    "items": [
      {
        "x": 38,
        "text": "from 20th June to 11th July (22 days)."
      },
      {
        "x": 296,
        "text": "1.00"
      },
      {
        "x": 448,
        "text": "*(An additional charge of Rs.100 will be"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 801,
    "text": "applicable on missing payment of",
    "items": [
      {
        "x": 448,
        "text": "applicable on missing payment of"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 796,
    "text": "Interest on Rs. 10,000 @ 3.75% p.m. from 11th July to 20th July (10",
    "items": [
      {
        "x": 38,
        "text": "Interest on Rs. 10,000 @ 3.75% p.m. from 11th July to 20th July (10"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 792,
    "text": "123.29 Minimum Amount Due (MAD) by the due",
    "items": [
      {
        "x": 288,
        "text": "123.29"
      },
      {
        "x": 448,
        "text": "Minimum Amount Due (MAD) by the due"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 788,
    "text": "days)",
    "items": [
      {
        "x": 38,
        "text": "days)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 785,
    "text": "date for two consecutive cycles.)",
    "items": [
      {
        "x": 448,
        "text": "date for two consecutive cycles.)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 778,
    "text": "Interest on 10,633.64 (Remaining purchase balance after partial",
    "items": [
      {
        "x": 38,
        "text": "Interest on 10,633.64 (Remaining purchase balance after partial"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 770,
    "text": "payment of 20,000) @ 3.75% p.m. from 12th July to 20th July (9 117.99",
    "items": [
      {
        "x": 38,
        "text": "payment of 20,000) @ 3.75% p.m. from 12th July to 20th July (9"
      },
      {
        "x": 288,
        "text": "117.99"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 765,
    "text": "2.5% of over limit amount",
    "items": [
      {
        "x": 448,
        "text": "2.5% of over limit amount"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 761,
    "text": "days) Over limit Penalty",
    "items": [
      {
        "x": 38,
        "text": "days)"
      },
      {
        "x": 324,
        "text": "Over limit Penalty"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 757,
    "text": "(Min. Rs 500)",
    "items": [
      {
        "x": 448,
        "text": "(Min. Rs 500)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 753,
    "text": "Total Interest charged on 20th July 1296.39",
    "items": [
      {
        "x": 38,
        "text": "Total Interest charged on 20th July"
      },
      {
        "x": 284,
        "text": "1296.39"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 743,
    "text": "Foreign Currency transaction Fee 3.5% of transaction value",
    "items": [
      {
        "x": 324,
        "text": "Foreign Currency transaction Fee"
      },
      {
        "x": 448,
        "text": "3.5% of transaction value"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 736,
    "text": "Actual interest calculation would vary based on the individual purchases and revolve",
    "items": [
      {
        "x": 34,
        "text": "Actual interest calculation would vary based on the individual purchases and revolve"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 729,
    "text": "2% of payment amount subject to",
    "items": [
      {
        "x": 448,
        "text": "2% of payment amount subject to"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 725,
    "text": "behaviour. Please note that making only minimum payment due every month would Cheque return or Dishonour Fee",
    "items": [
      {
        "x": 34,
        "text": "behaviour. Please note that making only minimum payment due every month would"
      },
      {
        "x": 324,
        "text": "Cheque return or Dishonour Fee"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 721,
    "text": "minimum Rs. 500",
    "items": [
      {
        "x": 448,
        "text": "minimum Rs. 500"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 716,
    "text": "result in the repayment stretching over years with consequent Interest payment.For",
    "items": [
      {
        "x": 34,
        "text": "result in the repayment stretching over years with consequent Interest payment.For"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 706,
    "text": "more details, refer the Terms and Condition on the website. (www.axis.bank.in/tncs) Surcharge on Purchase or",
    "items": [
      {
        "x": 34,
        "text": "more details, refer the Terms and Condition on the website. (www.axis.bank.in/tncs)"
      },
      {
        "x": 324,
        "text": "Surcharge on Purchase or"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 701,
    "text": "As prescribed by IRCTC/ Indian Railways",
    "items": [
      {
        "x": 448,
        "text": "As prescribed by IRCTC/ Indian Railways"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 697,
    "text": "cancellation of railway tickets",
    "items": [
      {
        "x": 324,
        "text": "cancellation of railway tickets"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 683,
    "text": "Minimum Amount Due Calculation Joining Fee & Annual fees As",
    "items": [
      {
        "x": 41,
        "text": "Minimum Amount Due Calculation"
      },
      {
        "x": 448,
        "text": "Joining Fee & Annual fees As"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 675,
    "text": "Joining Fee & Annual fees communicated at the time of onboarding",
    "items": [
      {
        "x": 324,
        "text": "Joining Fee & Annual fees"
      },
      {
        "x": 448,
        "text": "communicated at the time of onboarding"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 668,
    "text": "Assume that you have paid all previous dues in full, and do not have any amount or through subsequent communications",
    "items": [
      {
        "x": 34,
        "text": "Assume that you have paid all previous dues in full, and do not have any amount"
      },
      {
        "x": 448,
        "text": "or through subsequent communications"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 661,
    "text": "outstanding in your Credit Card Account, and your monthly statement is generated on",
    "items": [
      {
        "x": 34,
        "text": "outstanding in your Credit Card Account, and your monthly statement is generated on"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 653,
    "text": "the 15th of every month.",
    "items": [
      {
        "x": 34,
        "text": "the 15th of every month."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 650,
    "text": "Add On card - Joining & Annual Fees Waived",
    "items": [
      {
        "x": 324,
        "text": "Add On card - Joining & Annual Fees"
      },
      {
        "x": 448,
        "text": "Waived"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 634,
    "text": "Fees/charge’s structure is subject to change from time to time at the sole",
    "items": [
      {
        "x": 325,
        "text": "Fees/charge’s structure is subject to change from time to time at the sole"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 624,
    "text": "Txn Date Type Cr/Db MAD Contribution Amount discretion of Axis Bank. Penal interest, late payment charges and other related",
    "items": [
      {
        "x": 37,
        "text": "Txn Date"
      },
      {
        "x": 74,
        "text": "Type"
      },
      {
        "x": 182,
        "text": "Cr/Db"
      },
      {
        "x": 208,
        "text": "MAD Contribution"
      },
      {
        "x": 289,
        "text": "Amount"
      },
      {
        "x": 325,
        "text": "discretion of Axis Bank. Penal interest, late payment charges and other related"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 618,
    "text": "charges shall be levied only on the outstanding amount after the due date and",
    "items": [
      {
        "x": 325,
        "text": "charges shall be levied only on the outstanding amount after the due date and"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 612,
    "text": "25th Sep Purchase Db 2% 5000 not on the total amount.",
    "items": [
      {
        "x": 37,
        "text": "25th Sep"
      },
      {
        "x": 74,
        "text": "Purchase"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 268,
        "text": "2%"
      },
      {
        "x": 301,
        "text": "5000"
      },
      {
        "x": 325,
        "text": "not on the total amount."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 602,
    "text": "1st Oct Joining Fees Db 100% 1000",
    "items": [
      {
        "x": 37,
        "text": "1st Oct"
      },
      {
        "x": 74,
        "text": "Joining Fees"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 260,
        "text": "100%"
      },
      {
        "x": 301,
        "text": "1000"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 594,
    "text": "1st Oct GST on Joining Fees Db 100% 180 As per Ministry of finances guidelines, GST as per existing Government norms is",
    "items": [
      {
        "x": 37,
        "text": "1st Oct"
      },
      {
        "x": 74,
        "text": "GST on Joining Fees"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 260,
        "text": "100%"
      },
      {
        "x": 305,
        "text": "180"
      },
      {
        "x": 325,
        "text": "As per Ministry of finances guidelines, GST as per existing Government norms is"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 588,
    "text": "being levied on all fees, interest and other charges on all credit cards. No refund",
    "items": [
      {
        "x": 325,
        "text": "being levied on all fees, interest and other charges on all credit cards. No refund"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 584,
    "text": "1st Oct Cash Withdrawal Db 2% 2000",
    "items": [
      {
        "x": 37,
        "text": "1st Oct"
      },
      {
        "x": 74,
        "text": "Cash Withdrawal"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 268,
        "text": "2%"
      },
      {
        "x": 301,
        "text": "2000"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 580,
    "text": "shall be provided for GST charged on fuel surcharge.",
    "items": [
      {
        "x": 325,
        "text": "shall be provided for GST charged on fuel surcharge."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 575,
    "text": "1st Oct Cash Withdrawal Fee Db 100% 500",
    "items": [
      {
        "x": 37,
        "text": "1st Oct"
      },
      {
        "x": 74,
        "text": "Cash Withdrawal Fee"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 260,
        "text": "100%"
      },
      {
        "x": 305,
        "text": "500"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 566,
    "text": "1st Oct GST Db 100% 90 For type and details of insurance on your card please visit",
    "items": [
      {
        "x": 37,
        "text": "1st Oct"
      },
      {
        "x": 74,
        "text": "GST"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 260,
        "text": "100%"
      },
      {
        "x": 309,
        "text": "90"
      },
      {
        "x": 324,
        "text": "For type and details of insurance on your card please visit"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 553,
    "text": "https://www.axis.bank.in/ccins",
    "items": [
      {
        "x": 324,
        "text": "https://www.axis.bank.in/ccins"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 550,
    "text": "15th Oct Interest on Cash withdrawal Db 100% 36.99",
    "items": [
      {
        "x": 37,
        "text": "15th Oct"
      },
      {
        "x": 74,
        "text": "Interest on Cash withdrawal"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 260,
        "text": "100%"
      },
      {
        "x": 299,
        "text": "36.99"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 543,
    "text": "Third-party Insurance provider – The New India Insurance Company Ltd.",
    "items": [
      {
        "x": 324,
        "text": "Third-party Insurance provider – The New India Insurance Company Ltd."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 533,
    "text": "15th Oct GST on Interest Db 100% 6.66 at 022 - 22020714 or Email on- nia.990000@newindia.co.in",
    "items": [
      {
        "x": 37,
        "text": "15th Oct"
      },
      {
        "x": 74,
        "text": "GST on Interest"
      },
      {
        "x": 182,
        "text": "Db"
      },
      {
        "x": 260,
        "text": "100%"
      },
      {
        "x": 303,
        "text": "6.66"
      },
      {
        "x": 324,
        "text": "at 022 - 22020714 or Email on- nia.990000@newindia.co.in"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 524,
    "text": "Total Amount Due 8813.65 For any Insurance related queries please contact Axis Bank at 1800 103 5577",
    "items": [
      {
        "x": 199.5,
        "text": "Total Amount Due"
      },
      {
        "x": 291,
        "text": "8813.65"
      },
      {
        "x": 324,
        "text": "For any Insurance related queries please contact Axis Bank at 1800 103 5577"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 512,
    "text": "Minimum Amount Due 1953.65 Billing Dispute Resolution",
    "items": [
      {
        "x": 191.5,
        "text": "Minimum Amount Due"
      },
      {
        "x": 291,
        "text": "1953.65"
      },
      {
        "x": 336,
        "text": "Billing Dispute Resolution"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 498,
    "text": "“In case of any billing dispute notified to Axis bank, Axis bank will suspend",
    "items": [
      {
        "x": 327,
        "text": "“In case of any billing dispute notified to Axis bank, Axis bank will suspend"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 490,
    "text": "reporting to credit bureau till the dispute is resolved”.",
    "items": [
      {
        "x": 327,
        "text": "reporting to credit bureau till the dispute is resolved”."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 482,
    "text": "All contents of this statement shall be deemed to be correct and accepted by",
    "items": [
      {
        "x": 327,
        "text": "All contents of this statement shall be deemed to be correct and accepted by"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 474,
    "text": "Revised MAD computation logic : you, unless you inform us of any discrepancies within 21 days of the date of this",
    "items": [
      {
        "x": 34,
        "text": "Revised MAD computation logic :"
      },
      {
        "x": 327,
        "text": "you, unless you inform us of any discrepancies within 21 days of the date of this"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 466,
    "text": "statement, and these are found by you, unless you inform us. On receipt of such",
    "items": [
      {
        "x": 327,
        "text": "statement, and these are found by you, unless you inform us. On receipt of such"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 458,
    "text": "MAD = 2% of Purchase and Cash Withdrawal + 100% of Joining Fees, Cash Withdrawal information, we may reverse the charges on a temporary basis. If on",
    "items": [
      {
        "x": 36,
        "text": "MAD = 2% of Purchase and Cash Withdrawal + 100% of Joining Fees, Cash Withdrawal"
      },
      {
        "x": 327,
        "text": "information,"
      },
      {
        "x": 372.4,
        "text": "we"
      },
      {
        "x": 387.7,
        "text": "may"
      },
      {
        "x": 407.1,
        "text": "reverse"
      },
      {
        "x": 437.5,
        "text": "the"
      },
      {
        "x": 453.8,
        "text": "charges"
      },
      {
        "x": 484.2,
        "text": "on"
      },
      {
        "x": 497.5,
        "text": "a"
      },
      {
        "x": 506.9,
        "text": "temporary"
      },
      {
        "x": 547.3,
        "text": "basis."
      },
      {
        "x": 570.6,
        "text": "If"
      },
      {
        "x": 580,
        "text": "on"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 452,
    "text": "Fee, Interest on cash withdrawal, GST & GST on Interest completion of subsequent investigation, we are satisfied that the liability of",
    "items": [
      {
        "x": 36,
        "text": "Fee, Interest on cash withdrawal, GST & GST on Interest"
      },
      {
        "x": 327,
        "text": "completion of subsequent investigation, we are satisfied that the liability of"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 442,
    "text": "such charge is to your account, we will reinstate the charge in the subsequent",
    "items": [
      {
        "x": 327,
        "text": "such charge is to your account, we will reinstate the charge in the subsequent"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 436,
    "text": "MAD = 2%*(5000+2000) + 100%*(1000+180+500+18+36.99+6.66) = 1953.65 statement.",
    "items": [
      {
        "x": 34,
        "text": "MAD = 2%*(5000+2000) + 100%*(1000+180+500+18+36.99+6.66) = 1953.65"
      },
      {
        "x": 327,
        "text": "statement."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 417,
    "text": "Grievance Redressal Mechanism Report Loss, Theft or Unauthorised use of Card or",
    "items": [
      {
        "x": 39,
        "text": "Grievance Redressal Mechanism"
      },
      {
        "x": 330.7,
        "text": "Report Loss, Theft or Unauthorised use of Card or"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 404,
    "text": "Level 1 - Call Centre numbers: 1800 419 0068 Pin",
    "items": [
      {
        "x": 33,
        "text": "Level 1 - Call Centre numbers: 1800 419 0068"
      },
      {
        "x": 328,
        "text": "Pin"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 390,
    "text": "To report loss, theft or unauthorised use of card or Pin, customer has to block the",
    "items": [
      {
        "x": 321,
        "text": "To report loss, theft or unauthorised use of card or Pin, customer has to block the"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 382,
    "text": "card. Customer can use any of the below three mediums to block their credit",
    "items": [
      {
        "x": 321,
        "text": "card. Customer can use any of the below three mediums to block their credit"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 375,
    "text": "Axis Support: www.axis.bank.in/support/",
    "items": [
      {
        "x": 65,
        "text": "Axis Support: www.axis.bank.in/support/"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 368,
    "text": "Send an SMS – BLOCK <space> last 4 digits of card number and send it to",
    "items": [
      {
        "x": 336,
        "text": "Send an SMS – BLOCK <space> last 4 digits of card number and send it to"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 364,
    "text": "Branches /Loan Centres (please visit www.axis.bank.in to locate the nearest",
    "items": [
      {
        "x": 65,
        "text": "Branches /Loan Centres (please visit www.axis.bank.in to locate the nearest"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 360,
    "text": "5616160",
    "items": [
      {
        "x": 336,
        "text": "5616160"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 356,
    "text": "branch /loan centre)",
    "items": [
      {
        "x": 65,
        "text": "branch /loan centre)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 347,
    "text": "Call the Phone banking number (IVR) 1860 419 5555,1860 500 5555 and",
    "items": [
      {
        "x": 334,
        "text": "Call the Phone banking number (IVR) 1860 419 5555,1860 500 5555"
      },
      {
        "x": 574,
        "text": "and"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 341,
    "text": "Level 2 select 0 to block the card",
    "items": [
      {
        "x": 35,
        "text": "Level 2"
      },
      {
        "x": 334,
        "text": "select 0 to block the card"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 328,
    "text": "Write Email Call",
    "items": [
      {
        "x": 76,
        "text": "Write"
      },
      {
        "x": 164.5,
        "text": "Email"
      },
      {
        "x": 258,
        "text": "Call"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 324,
    "text": "Go on the Mobile App and block the credit card",
    "items": [
      {
        "x": 335,
        "text": "Go on the Mobile App and block the credit card"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 307,
    "text": "Contact Us:",
    "items": [
      {
        "x": 329,
        "text": "Contact Us:"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 295,
    "text": "Mr. Jinit Thakkar Nodal For any clarification on your credit card statement",
    "items": [
      {
        "x": 45.5,
        "text": "Mr. Jinit Thakkar Nodal"
      },
      {
        "x": 329,
        "text": "For any clarification on your credit card statement"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 290,
    "text": "Ph. 080-61865200 Timings: 9.30",
    "items": [
      {
        "x": 212.5,
        "text": "Ph. 080-61865200 Timings: 9.30"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 287,
    "text": "Officer Address : Axis Bank Phone: 1800 103 5577",
    "items": [
      {
        "x": 41.5,
        "text": "Officer Address : Axis Bank"
      },
      {
        "x": 329,
        "text": "Phone: 1800 103 5577"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 282,
    "text": "am to 5.30 pm Monday to",
    "items": [
      {
        "x": 212.5,
        "text": "am to 5.30 pm Monday to"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 279,
    "text": "Ltd, CPU 1st Floor, \"Gigaplex\", Nodal.officer@axis.ba Email: www.axis.bank.in/support",
    "items": [
      {
        "x": 36.5,
        "text": "Ltd, CPU 1st Floor, \"Gigaplex\","
      },
      {
        "x": 138.5,
        "text": "Nodal.officer@axis.ba"
      },
      {
        "x": 329,
        "text": "Email: www.axis.bank.in/support"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 274,
    "text": "Saturday (except second and",
    "items": [
      {
        "x": 212.5,
        "text": "Saturday (except second and"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 271,
    "text": "Plot No I.T.5, MIDC, Airoli nk.in Send correspondence to: Manager, Customer care, Axis Bank Ltd, CPU",
    "items": [
      {
        "x": 43.5,
        "text": "Plot No I.T.5, MIDC, Airoli"
      },
      {
        "x": 165.5,
        "text": "nk.in"
      },
      {
        "x": 329,
        "text": "Send correspondence to: Manager, Customer care, Axis Bank Ltd, CPU"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 266,
    "text": "fourth Saturdays and Bank",
    "items": [
      {
        "x": 212.5,
        "text": "fourth Saturdays and Bank"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 263,
    "text": "Knowledge Park, Airoli Navi 1st Floor, \"Gigaplex\", Plot No I.T.5, MIDC, Airoli Knowledge Park, Airoli",
    "items": [
      {
        "x": 39.5,
        "text": "Knowledge Park, Airoli Navi"
      },
      {
        "x": 329,
        "text": "1st Floor, \"Gigaplex\", Plot No I.T.5, MIDC, Airoli Knowledge Park, Airoli"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 258,
    "text": "Holidays)",
    "items": [
      {
        "x": 212.5,
        "text": "Holidays)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 255,
    "text": "Mumbai-400708 Navi Mumbai-400708",
    "items": [
      {
        "x": 59,
        "text": "Mumbai-400708"
      },
      {
        "x": 329,
        "text": "Navi Mumbai-400708"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 232,
    "text": "Disclosure :",
    "items": [
      {
        "x": 332,
        "text": "Disclosure :"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 218,
    "text": "Level 3 “Axis bank may tie up with credit bureau authorized by RBI and will share credit",
    "items": [
      {
        "x": 36,
        "text": "Level 3"
      },
      {
        "x": 325,
        "text": "“Axis bank may tie up with credit bureau authorized by RBI and will share credit"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 210,
    "text": "information including but not limited to your current balance, payment history,",
    "items": [
      {
        "x": 325,
        "text": "information including but not limited to your current balance, payment history,"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 202,
    "text": "Write Email Call demographic details, etc. the credit bureau do not provide any opinion,",
    "items": [
      {
        "x": 75,
        "text": "Write"
      },
      {
        "x": 163.5,
        "text": "Email"
      },
      {
        "x": 257,
        "text": "Call"
      },
      {
        "x": 325,
        "text": "demographic"
      },
      {
        "x": 371.9,
        "text": "details,"
      },
      {
        "x": 400.8,
        "text": "etc."
      },
      {
        "x": 417.7,
        "text": "the"
      },
      {
        "x": 433.6,
        "text": "credit"
      },
      {
        "x": 457.5,
        "text": "bureau"
      },
      {
        "x": 485.4,
        "text": "do"
      },
      {
        "x": 498.3,
        "text": "not"
      },
      {
        "x": 514.2,
        "text": "provide"
      },
      {
        "x": 544.1,
        "text": "any"
      },
      {
        "x": 561,
        "text": "opinion,"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 194,
    "text": "indication or comment pertaining to whatever credit should or should not be",
    "items": [
      {
        "x": 325,
        "text": "indication or comment pertaining to whatever credit should or should not be"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 186,
    "text": "granted. It is your best interest to maintain a good credit history by paying the",
    "items": [
      {
        "x": 325,
        "text": "granted. It is your best interest to maintain a good credit history by paying the"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 178,
    "text": "necessary dues in a timely manner. With credit bureau in place, responsible",
    "items": [
      {
        "x": 325,
        "text": "necessary dues in a timely manner. With credit bureau in place, responsible"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 170,
    "text": "Mrs. Deepti Radkar Principal customers can expect faster and more competitive services at better terms from",
    "items": [
      {
        "x": 37.5,
        "text": "Mrs. Deepti Radkar Principal"
      },
      {
        "x": 325,
        "text": "customers can expect faster and more competitive services at better terms from"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 165,
    "text": "Ph. 080-61865098 Timings: 9.30",
    "items": [
      {
        "x": 211.5,
        "text": "Ph. 080-61865098 Timings: 9.30"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 162,
    "text": "Nodal Officer Address: Axis credit grantors. Default by customer would be available with credit bureau,",
    "items": [
      {
        "x": 41,
        "text": "Nodal Officer Address: Axis"
      },
      {
        "x": 325,
        "text": "credit grantors. Default by customer would be available with credit bureau,"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 157,
    "text": "am to 5.30 pm Monday to",
    "items": [
      {
        "x": 211.5,
        "text": "am to 5.30 pm Monday to"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 154,
    "text": "Bank Ltd, NPC1, 5th Floor, which in turn would impact your credit worthiness for the future.Charges",
    "items": [
      {
        "x": 36,
        "text": "Bank Ltd, NPC1, 5th Floor,"
      },
      {
        "x": 325,
        "text": "which in turn would impact your credit worthiness for the future.Charges"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 149,
    "text": "pno@axis.bank.in Saturday (except second and",
    "items": [
      {
        "x": 136.5,
        "text": "pno@axis.bank.in"
      },
      {
        "x": 211.5,
        "text": "Saturday (except second and"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 146,
    "text": "“Gigaplex”, Plot No. I.T.5, structure is subject to change form time at the sole discretion of Axis Bank.",
    "items": [
      {
        "x": 43.5,
        "text": "“Gigaplex”, Plot No. I.T.5,"
      },
      {
        "x": 325,
        "text": "structure is subject to change form time at the sole discretion of Axis Bank."
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 141,
    "text": "fourth Saturdays and Bank",
    "items": [
      {
        "x": 211.5,
        "text": "fourth Saturdays and Bank"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 138,
    "text": "MIDC, Airoli Knowledge Park, Please make your payment by due date. Late payment will result in reporting",
    "items": [
      {
        "x": 36,
        "text": "MIDC, Airoli Knowledge Park,"
      },
      {
        "x": 325,
        "text": "Please make your payment by due date."
      },
      {
        "x": 464.8,
        "text": "Late payment will result in reporting"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 133,
    "text": "Holidays)",
    "items": [
      {
        "x": 211.5,
        "text": "Holidays)"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 130,
    "text": "Airoli, Navi Mumbai-400708 to Credit Bureau. Credit Bureau include Credit reference Agencies, Credit",
    "items": [
      {
        "x": 38.5,
        "text": "Airoli, Navi Mumbai-400708"
      },
      {
        "x": 325,
        "text": "to Credit Bureau. Credit Bureau include Credit reference Agencies, Credit"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 122,
    "text": "Information companies or any other entity formed and authorized by RBI for the",
    "items": [
      {
        "x": 325,
        "text": "Information companies or any other entity formed and authorized by RBI for the"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 114,
    "text": "purpose of collecting, collating and disseminating credit information pertaining",
    "items": [
      {
        "x": 325,
        "text": "purpose of collecting, collating and disseminating credit information pertaining"
      }
    ]
  },
  {
    "pageNumber": 3,
    "y": 106,
    "text": "to borrowers.”",
    "items": [
      {
        "x": 325,
        "text": "to borrowers.”"
      }
    ]
  }
];
