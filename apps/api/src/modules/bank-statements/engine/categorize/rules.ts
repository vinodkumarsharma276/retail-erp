import type { Channel, Direction } from '../types.js';

interface BuiltinRule {
  category: string;
  re: RegExp;
  direction?: Direction;
  channel?: Channel;
  confidence?: number;
}

/**
 * Built-in keyword rules, evaluated top to bottom; first match wins. Tuned for Indian retail
 * businesses (electronics / appliances) but covers common personal and global merchants too.
 */
export const BUILTIN_RULES: BuiltinRule[] = [
  // --- Reversals & refunds first so they don't get caught by merchant rules.
  { category: 'Refunds & Reversals', re: /\b(REFUND|REVERSAL|REV\b|REVERSED|CHARGEBACK|CASHBACK|RETURN(ED)?)\b/i, direction: 'credit' },

  // --- Bank-originated
  { category: 'Interest & Dividends', re: /\b(INT(EREST)?\.?\s*(PD|PAID|CR|CREDIT|ON)|SB INT|INTEREST|DIVIDEND|DIV\b)/i, direction: 'credit' },
  { category: 'Taxes & Government', re: /\b(GST ?(PMT|PAYMENT|CHALLAN)|GSTN|CBDT|TDS|TAX ?(PAYMENT|PMT)|INCOME ?TAX|ADVANCE TAX|CHALLAN|OLTAS|EPFO|ESIC|PROFESSIONAL TAX|MUNICIPAL|MCD|PROPERTY TAX|TRAFFIC CHALLAN|ICEGATE|CUSTOMS)\b/i, direction: 'debit' },
  { category: 'Bank Charges & Fees', re: /\b(CHARGES?|CHGS?|SMS ALERT|AMC|ANNUAL FEE|MIN(IMUM)? BAL|NON[- ]?MAINT|DEBIT CARD FEE|CHEQUE BOOK|STOP PAYMENT|PENAL|RETURN CHG|ECS RTN CHG|GST ON|IGST|CGST|SGST)\b/i, direction: 'debit' },

  // --- Taxes

  // --- Payment aggregator settlements = shop sales
  { category: 'Business Income', re: /\b(PINE ?LABS|PINELABS|RAZORPAY|PAYU|CCAVENUE|CASHFREE|INSTAMOJO|BHARATPE|MSWIPE|EZETAP|PAYTM ?(PAYMENTS|SETTLEMENT|MERCHANT)|PHONEPE ?(PVT|SETTLEMENT|MERCHANT)|SETTLEMENT|SETL|MERCHANT SETTLE|POS SETTLEMENT|CARD SETTLEMENT|BAJAJ FIN(ANCE)?|HDB FIN|HOME CREDIT|TVS CREDIT|IDFC FIRST.*EMI)\b/i, direction: 'credit', confidence: 0.85 },
  { category: 'Salary & Payroll Income', re: /\b(SALARY|SAL\b|PAYROLL|STIPEND|WAGES)\b/i, direction: 'credit' },
  { category: 'Cash Deposit', re: /\b(CASH ?DEP(OSIT)?|BY CASH|CDM|CASH-?CDM|CSH DEP)\b/i, direction: 'credit' },

  // --- Cash out
  { category: 'Cash Withdrawal', re: /\b(ATM|NWD|CASH ?(WDL|WITHDRAWAL|W\/D)|ATW|SELF CHQ|CHQ PAID.*SELF|TO CASH)\b/i, direction: 'debit' },

  // --- Loans / EMI / credit cards
  { category: 'Credit Card Payment', re: /\b(CREDIT ?CARD|CC ?(PAYMENT|PMT|BILL)|CARD ?(DUES|BILL)|BILLDESK.*CARD|CRED\b|CARD NO\s*X+)/i, direction: 'debit' },
  { category: 'Loan & EMI', re: /\b(EMI|LOAN|LN ?REPAY|HOME ?LOAN|CAR ?LOAN|NACH.*(FIN|LOAN|CAPITAL)|BAJAJ ?FIN|TATA ?CAPITAL|MUTHOOT|MANAPPURAM|HDFC ?LTD|LIC HFL|FULLERTON|CAPITAL FLOAT|LENDINGKART|OD INT)\b/i, direction: 'debit' },

  // --- Investments & insurance
  { category: 'Investments', re: /\b(MUTUAL ?FUND|\bMF\b|SIP|ZERODHA|GROWW|UPSTOX|ANGEL ?(ONE|BROKING)|ICICI ?SEC|HDFC ?SEC|KOTAK ?SEC|NSE|BSE|CDSL|NSDL|PPF|NPS|SGB|FIXED DEPOSIT|\bFD\b|RD ?INST|RECURRING DEPOSIT|KUVERA|COIN BY|SMALLCASE|INDMONEY|DEMAT)\b/i },
  { category: 'Insurance', re: /\b(INSURANCE|LIC\b|LIFE INS|POLICY|PREMIUM|HDFC ?ERGO|ICICI ?LOMBARD|BAJAJ ?ALLIANZ|STAR ?HEALTH|MAX ?LIFE|TATA ?AIA|SBI ?LIFE|NIVA ?BUPA|DIGIT ?INS|ACKO|CARE ?HEALTH|POLICYBAZAAR)\b/i, direction: 'debit' },

  // --- Business operations
  { category: 'Vendor & Supplier Payments', re: /\b(SAMSUNG|LG ELECTRONICS|\bLG\b|SONY|WHIRLPOOL|VOLTAS|HAVELLS|BAJAJ ELECTRICALS|CROMPTON|ORIENT ELECTRIC|GODREJ|IFB|HAIER|PANASONIC|HITACHI|DAIKIN|BLUE ?STAR|CARRIER|LLOYD|KENT|EUREKA|PHILIPS|PRESTIGE|BUTTERFLY|PIGEON|V-?GUARD|USHA|SYMPHONY|BOSCH|SIEMENS|ONIDA|VIDEOCON|TCL|XIAOMI|REDMI|MI INDIA|ONEPLUS|OPPO|VIVO|REALME|APPLE INDIA|DISTRIBUT|WHOLESALE|TRADERS|ENTERPRISES|AGENCIES|SUPPLIER|VENDOR|SALES CORP|INDUSTRIES|REDINGTON|INGRAM|SUPERTRON|IMPEX)\b/i, direction: 'debit', confidence: 0.8 },
  { category: 'Payroll & Salaries Paid', re: /\b(SALARY|SAL\b|WAGES|PAYROLL|STAFF|INCENTIVE|BONUS|ADVANCE TO)\b/i, direction: 'debit' },
  { category: 'Software & SaaS', re: /\b(GOOGLE ?(WORKSPACE|CLOUD|GSUITE)|MICROSOFT|AZURE|AWS|AMAZON WEB|ZOHO|TALLY|BUSY ?INFOTECH|MARG ?ERP|VYAPAR|KHATABOOK|OKCREDIT|GODADDY|HOSTINGER|NAMECHEAP|SHOPIFY|CANVA|ADOBE|NOTION|SLACK|ATLASSIAN|GITHUB|OPENAI|CHATGPT|DROPBOX|MYBILLBOOK|GOFRUGAL)\b/i, direction: 'debit' },
  { category: 'Marketing & Advertising', re: /\b(FACEBOOK|FB ?ADS|META ?(PLATFORMS|ADS)|GOOGLE ?ADS|ADWORDS|JUSTDIAL|INDIAMART|SULEKHA|NEWSPAPER|PAMPHLET|HOARDING|PRINTING|FLEX|SMS ?GATEWAY|MSG91|TEXTLOCAL|WATI|INTERAKT|ADVERTIS)\b/i, direction: 'debit' },
  { category: 'Professional Services', re: /\b(CA FEES?|CHARTERED|AUDIT|LEGAL|ADVOCATE|LAWYER|CONSULT(ANT|ING)|ACCOUNTANT|COMPLIANCE|CLEARTAX|VAKILSEARCH|INDIAFILINGS)\b/i, direction: 'debit' },
  { category: 'Office & Supplies', re: /\b(STATIONERY|OFFICE ?SUPPL|FURNITURE|COURIER|DTDC|BLUE ?DART|DELHIVERY|SHIPROCKET|ECOM ?EXPRESS|XPRESSBEES|PORTER|TRANSPORT(ERS)?|LOGISTICS|PACKAGING|PACKERS|TEMPO|LOADING)\b/i, direction: 'debit' },

  // --- Living
  { category: 'Rent & Housing', re: /\b(RENT|LEASE|LANDLORD|NOBROKER|MAINTENANCE|SOCIETY|HOUSING|MYGATE|NESTAWAY)\b/i, direction: 'debit' },
  { category: 'Utilities & Bills', re: /\b(ELECTRICITY|BESCOM|MSEDCL|TNEB|BSES|TATA ?POWER|ADANI ?(ELEC|POWER)|TORRENT|CESC|UPPCL|PSPCL|DHBVN|UHBVN|JVVNL|AVVNL|WATER ?BILL|JAL ?BOARD|GAS ?BILL|INDANE|HP ?GAS|BHARAT ?GAS|IGL|MGL|AIRTEL|JIO|RELIANCE ?JIO|VODAFONE|\bVI\b|BSNL|MTNL|ACT ?FIBERNET|HATHWAY|TATA ?PLAY|DISH ?TV|D2H|SUN ?DIRECT|BROADBAND|RECHARGE|POSTPAID|PREPAID|BBPS|BILLDESK|BILL ?PAY)\b/i, direction: 'debit' },
  { category: 'Fuel', re: /\b(PETROL|DIESEL|FUEL|HPCL|BPCL|IOCL|INDIAN ?OIL|BHARAT ?PETROLEUM|HINDUSTAN ?PETROLEUM|SHELL|NAYARA|FILLING ?STATION|SERVICE ?STATION|CNG)\b/i, direction: 'debit' },
  { category: 'Groceries', re: /\b(BIGBASKET|BIG ?BASKET|BLINKIT|GROFERS|ZEPTO|INSTAMART|DMART|AVENUE ?SUPERMARTS|RELIANCE ?(FRESH|SMART|RETAIL)|MORE ?(RETAIL|SUPERMARKET)|SPENCER|STAR ?BAZAAR|NATURE'?S ?BASKET|JIOMART|KIRANA|GROCER|SUPERMARKET|MILK|DAIRY|MOTHER ?DAIRY|AMUL|COUNTRY ?DELIGHT)\b/i, direction: 'debit' },
  { category: 'Healthcare', re: /\b(HOSPITAL|CLINIC|PHARMA|PHARMACY|MEDICAL|MEDICOS|CHEMIST|APOLLO|FORTIS|MAX ?HEALTH|MEDANTA|NETMEDS|PHARMEASY|1MG|TATA ?1MG|PRACTO|DIAGNOSTIC|PATHLAB|LAL ?PATH|THYROCARE|DENTAL|DOCTOR|DR\.)\b/i, direction: 'debit' },
  { category: 'Education', re: /\b(SCHOOL|COLLEGE|UNIVERSITY|TUITION|COACHING|ACADEMY|BYJU|UNACADEMY|VEDANTU|UDEMY|COURSERA|EXAM ?FEE|ADMISSION)\b/i, direction: 'debit' },

  // --- Lifestyle
  { category: 'Food & Dining', re: /\b(SWIGGY|ZOMATO|DOMINOS|DOMINO'?S|PIZZA ?HUT|MCDONALD|KFC|BURGER ?KING|SUBWAY|STARBUCKS|CAFE|COFFEE|CHAAYOS|HALDIRAM|BIKANERVALA|RESTAURANT|DHABA|HOTEL(?! BOOKING)|FOOD|BAKERY|SWEETS|EATERY|EATSURE|FAASOS|BEHROUZ)\b/i, direction: 'debit' },
  { category: 'Travel & Transport', re: /\b(UBER|OLA\b|OLACABS|RAPIDO|IRCTC|RAILWAY|INDIGO|INTERGLOBE|SPICEJET|AIR ?INDIA|VISTARA|AKASA|MAKEMYTRIP|GOIBIBO|CLEARTRIP|YATRA|IXIGO|REDBUS|ABHIBUS|OYO|AIRBNB|FASTAG|NETC|TOLL|NHAI|PARKING|METRO|DMRC|BMTC|BEST ?BUS)\b/i, direction: 'debit' },
  { category: 'Entertainment & Subscriptions', re: /\b(NETFLIX|PRIME ?VIDEO|AMAZON ?PRIME|HOTSTAR|DISNEY|SONYLIV|ZEE5|SPOTIFY|GAANA|WYNK|YOUTUBE|APPLE\.COM|ITUNES|GOOGLE ?PLAY|BOOKMYSHOW|PVR|INOX|CINEPOLIS|DREAM11|MPL)\b/i, direction: 'debit' },
  { category: 'Shopping', re: /\b(AMAZON|AMZN|FLIPKART|MYNTRA|AJIO|MEESHO|NYKAA|TATA ?CLIQ|SNAPDEAL|CROMA|RELIANCE ?DIGITAL|VIJAY ?SALES|DECATHLON|IKEA|LIFESTYLE|SHOPPERS ?STOP|PANTALOONS|WESTSIDE|MAX ?FASHION|TRENDS|ZUDIO|H&M|UNIQLO|LENSKART|TANISHQ|CARATLANE|PURCHASE|MALL)\b/i, direction: 'debit' },

  // --- Transfers between own accounts
  { category: 'Self Transfer', re: /\b(SELF ?TRANSFER|OWN ?ACCOUNT|TO SELF|FROM SELF|SWEEP|FD ?(CLOSURE|PREMAT)|LINKED ?(A\/?C|ACCOUNT)|INTERNAL ?TRF)\b/i },
];

export function applyBuiltinRules(desc: string, direction: Direction, channel: Channel) {
  for (const r of BUILTIN_RULES) {
    if (r.direction && r.direction !== direction) continue;
    if (r.channel && r.channel !== channel) continue;
    if (r.re.test(desc)) return { category: r.category, confidence: r.confidence ?? 0.9 };
  }
  // Channel-level fallbacks.
  if (channel === 'ATM/Cash') return { category: direction === 'debit' ? 'Cash Withdrawal' : 'Cash Deposit', confidence: 0.8 };
  return null;
}

export interface UserRule {
  id: string;
  pattern: string;
  match_type: 'contains' | 'regex';
  category: string;
  shop_id: string | null;
}

export function compileUserRules(rules: UserRule[]) {
  return rules.map((r) => {
    let re: RegExp;
    try {
      re = r.match_type === 'regex' ? new RegExp(r.pattern, 'i') : new RegExp(r.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
      re = /$^/; // invalid regex never matches
    }
    return { ...r, re };
  });
}
