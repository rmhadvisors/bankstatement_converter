// Real pdfjs-dist text-layer extraction for a Federal Bank statement ("fededal bank-019068.pdf")
// whose own baked-in text layer (not this app's OCR) is badly garbled. Distinct shape from every
// other Federal Bank sample: every row shares one recurring particulars token ("FB1854266"), every
// row is a deposit (zero withdrawals -- GRAND TOTAL only prints one column total as a result), and
// the header's "Particulars" column name is letter-spaced into "P a r t i CU1a r S..." past any
// literal-phrase match while "Withdrawals"/"Deposits"/"Balance" on the same line survive intact.
export const federal019068Lines = [
  "he g EKING PARTNER",
  "R",
  ": SWEET HOME APPARTMENT SHOP NO,WALIV VASAI Branch Sol ID 1575",
  "THANA, MAHARASHTRA Account Number 15750200019068",
  "INDIA-401208 Customer ID (UCIC) 22143356 CKYC No N",
  "Address Regd. Mobile Last Updated On Number 04-12-2009 Account Open Date Account Status 22-11-2022 ACTIVE",
  "Email ID : ; mohd 917021965051 khalidgroup@yahoo.co.in Mode of Operation JOINT",
  "TypeOf Account Current Account RERA - CA JointHolders NIL",
  "Scheme IFSC FDRLOOOI575",
  "MICR Code : 400049021 FDRLINBBIBD Nomination NOT REGISTERED",
  "SWIFT Code Effective Available Balance 6704880.00 Dateof Issue",
  "Statement of Account for the period 01-07-2026 to 31-07-2026 Balance ITyp. MitGO",
  "Date ValueDate P a r t i CU1a r S 1;;= 1 1r r a n 1 d I E : : it8 Withdrawals Deposits (Cr/Dr}",
  "}pening Balance 1732500.od CR",
  "02-07-2026 1 02.07-2026 1 FB1854266 TRF I sl042241 158900.001 1891400.001 CR",
  "10.07-2026 1 lo-07-2026 1 FB1854266 S35359856 4760.001 1896160.001 CR",
  "13.07-2026 1 13-07-2026 1 FB1854266 TRFI s84433720 70000.001 1966160.001 CR",
  "14-07-2026 1 14-07-2026 1 FB1854266 599281292 140000.oo1 2106160.001 CR",
  "15.07.2026 1 15-07-2026 1 FB1854266 TRF 1 816555172 260400.001 2366560.001 CR",
  "17.07-2026 1 17-07-2026 1 FB1854266 548558980 70000.001 2436560.001 CR",
  "24.07.2026 1 24-07-2026 1 FB1854266 TRF I s56451249 277900.001 2714460.001 CR",
  "27.07.2026 1 27-07-2026 1 FB1854266 S3740859 409500.001 3123960.001 CR",
  "28-07-2026 1 28.07-2026 1 FB1854266 S1 8995728 102200.001 3226160.001 CR",
  "30.07-2026 1 30-07-2026 1 FB1854266 TRF I s52935737 2250220.001 5476380.001 CR",
  "GRAND TOTAL 3743880.00",
  "Abbreviations Used TRF : TransferTransaction",
  "(,ASH FT : Fund Transfer : Cash Transaction CLG MB : : Mobile Banking Clearing Transaction",
  "TDINT SBINT : : Interest Interest on on Deposit SB Account TDS : Tax Deductedat source",
  "DISCLAIMER This is a computer generated statement which need not normally be signed. Contents of this statement will be considered correct statement date if no erroris reported within 21 days of the",
  "\"'- END OF STATEMENT \"\"",
  "Page 1 of 1",
  "THE FEDERAL BANK LTD. BRANCH:WAUV. OMKAR BUILDING CIN:L65191 . JAYNAGARIWAUVI VASAIEAST I THANEIMAHARASHTRA401208,contact@fedQral'bank'in,PH:1800 KL1931PLC000368 Website:ww.fed8ralbank.co.In 425 1 199",
];
