/**
 * FIELD_FORMAT_CATALOG — curated FI/equity blotter field names → format,
 * alignment, and typography. Ported from starui's fieldFormatCatalog and
 * adapted so every format is a plain @wellsfargo-starui/velocity-grid-format
 * DSL string (no preset objects). Trailing-comma K/M magnitude scaling is
 * not used — the format package does not scale on trailing commas.
 */
import type { FieldFormatEntry } from './types';

const num = (decimals: number, thousands = true): string => {
  const frac = decimals > 0 ? `.${'0'.repeat(decimals)}` : '';
  return thousands ? `#,##0${frac}` : `0${frac}`;
};

export const FIELD_FORMAT_CATALOG: readonly FieldFormatEntry[] = [
  {
    id: 'ticker',
    category: 'identifier',
    aliases: ['ticker', 'symbol', 'issuerticker', 'underlyingticker'],
    bold: true,
    alignment: 'left',
  },
  {
    id: 'price',
    category: 'price',
    aliases: [
      'price', 'bidprice', 'askprice', 'midprice', 'lastprice', 'cleanprice',
      'dirtyprice', 'theoprice', 'evalprice', 'priorclose', 'openprice',
      'highprice', 'lowprice', 'vwap', 'avgpx', 'avgcost', 'mark', 'limitprice',
      'stopprice', 'nextcallprice', 'coverprice', 'bestbid', 'bestoffer',
      'bid', 'ask', 'mid', 'last',
    ],
    suffixes: ['price'],
    format: num(4, false),
    alignment: 'right',
  },
  {
    id: 'yield',
    category: 'yield',
    aliases: [
      'yield', 'ytm', 'ytw', 'ytc', 'currentyield', 'bondequivyield', 'bey',
      'bidyield', 'askyield',
    ],
    suffixes: ['yield'],
    format: num(3, false),
    alignment: 'right',
  },
  {
    id: 'rate',
    category: 'rate',
    aliases: [
      'coupon', 'couponrate', 'rate', 'interestrate', 'wac', 'tbacoupon',
      'weightedloanrate', 'wlr', 'dividendyield', 'divyield', 'borrowrate',
      'participationrate', 'povrate',
    ],
    format: num(3, false),
    alignment: 'right',
  },
  {
    id: 'spread',
    category: 'spread',
    aliases: [
      'spread', 'oas', 'asw', 'gspread', 'ispread', 'zspread', 'discountmargin',
      'dm', 'benchspread', 'tradespread', 'swapspread', 'tedspread',
      'assetswaplevel', 'bidspread', 'askspread', 'markup', 'benchmarkspread',
    ],
    suffixes: ['spread'],
    format: num(1, false),
    alignment: 'right',
  },
  {
    id: 'pnl',
    category: 'pnl',
    aliases: [
      'pnl', 'pl', 'realizedpnl', 'unrealizedpnl', 'daypnl', 'dailypnl',
      'mtdpnl', 'ytdpnl', 'qtdpnl', 'inceptionpnl', 'itdpnl', 'carrypnl',
      'pricepnl', 'priceepnl', 'spreadpnl', 'ratepnl', 'fxpnl', 'financingpnl',
      'commissionpnl', 'stresspnl', 'unrealpnl', 'totalpnl',
    ],
    suffixes: ['pnl', 'pandl'],
    format: '[Green]#,##0.00;[Red]-#,##0.00;0.00',
    alignment: 'right',
  },
  {
    id: 'change-pct',
    category: 'change',
    aliases: ['pctchange', 'pctchg', 'changepct', 'daychgpct', 'daychangepct', 'pricechangepct', 'returnpct', 'ytdreturn'],
    suffixes: ['chgpct', 'changepct', 'returnpct', 'pctchange'],
    format: '[Green]+0.00"%";[Red]-0.00"%";0.00"%"',
    alignment: 'right',
  },
  {
    id: 'change',
    category: 'change',
    aliases: ['change', 'netchange', 'pricechange', 'daychange', 'daychg'],
    suffixes: ['change', 'netchg'],
    format: '[Green]+#,##0.00;[Red]-#,##0.00;0.00',
    alignment: 'right',
  },
  {
    id: 'quantity',
    category: 'quantity',
    aliases: [
      'qty', 'quantity', 'orderqty', 'leavesqty', 'cumqty', 'displayqty',
      'minqty', 'longqty', 'shortqty', 'netqty', 'position', 'sodposition',
      'bidsize', 'asksize', 'rfqsize', 'axesize', 'sharesout', 'floatshares',
      'adv', 'lotsize', 'boughttoday', 'soldtoday', 'tradedtoday', 'origface',
      'currentface', 'currentfacepos', 'issuesize', 'amtoutstanding', 'volume',
      'filled', 'openqty', 'quantityface', 'facevalue', 'shares',
    ],
    suffixes: ['qty', 'size', 'face'],
    format: '#,##0',
    alignment: 'right',
  },
  {
    id: 'fee',
    category: 'value',
    aliases: [
      'commission', 'fees', 'fee', 'secfee', 'brokerage', 'accruedint',
      'accruedinterest', 'minpiece', 'increment',
    ],
    format: num(2, true),
    alignment: 'right',
  },
  {
    id: 'notional',
    category: 'value',
    aliases: [
      'marketvalue', 'mktval', 'mktvalue', 'notional', 'principal', 'netmoney',
      'costbasis', 'bookvalue', 'netsettleamt', 'marketcap', 'amount',
      'avgcostbasis',
    ],
    suffixes: ['value', 'money', 'amount', 'amt', 'notional'],
    format: '#,##0.00',
    alignment: 'right',
  },
  {
    id: 'duration',
    category: 'risk',
    aliases: ['duration', 'modduration', 'macduration', 'effduration', 'spreadduration', 'oad', 'wal', 'walrisk'],
    suffixes: ['duration'],
    format: num(2, false),
    alignment: 'right',
  },
  {
    id: 'risk-sensitivity',
    category: 'risk',
    aliases: ['dv01', 'pv01', 'cs01', 'ir01', 'spreaddv01', 'netdv01', 'jtd', 'var95', 'vega', 'theta', 'rho'],
    suffixes: ['dv01', 'pv01', 'cs01'],
    format: num(2, true),
    alignment: 'right',
  },
  {
    id: 'greeks-ratio',
    category: 'risk',
    aliases: ['convexity', 'effconvexity', 'oac', 'delta', 'gamma', 'beta', 'dscr', 'hedgeratio', 'indexratio', 'accruedfactor', 'fxrate', 'factor'],
    format: num(4, false),
    alignment: 'right',
  },
  {
    id: 'count',
    category: 'count',
    aliases: ['wam', 'wala', 'seasoning', 'accrueddays', 'ratingnumeric', 'vintage', 'quotecount', 'responsetime', 'faildays', 'version', 'messageseq'],
    format: num(0, true),
    alignment: 'right',
  },
  {
    id: 'percent',
    category: 'percent',
    aliases: [
      'cpr', 'psa', 'smm', 'subordination', 'attachpoint', 'detachpoint', 'ltv',
      'originalltv', 'delinq30', 'delinq60', 'delinq90', 'cdr', 'severity',
      'watchlist', 'creditenh', 'weight', 'allocation', 'percent',
    ],
    suffixes: ['pct', 'percent', 'weight', 'ratio'],
    format: num(2, false),
    alignment: 'right',
  },
  {
    id: 'rating',
    category: 'rating',
    aliases: ['rating', 'ratingsp', 'ratingmoody', 'ratingfitch', 'ratingcomposite', 'compositerating', 'moodysrating', 'sprating', 'fitchrating', 'moody', 'moodys', 'sp', 'fitch', 'ighy', 'ratingoutlook'],
    suffixes: ['rating'],
    alignment: 'center',
  },
  {
    id: 'side',
    category: 'categorical',
    aliases: ['side', 'rfqside', 'direction', 'buysell', 'way', 'axeflag'],
    alignment: 'center',
  },
  {
    id: 'rfq-status',
    category: 'categorical',
    aliases: ['rfqstatus'],
    alignment: 'center',
  },
  {
    id: 'status',
    category: 'categorical',
    aliases: ['status', 'ordstatus', 'orderstatus', 'tradestatus', 'allocstatus', 'settlestatus', 'settlementstatus', 'confirmstatus', 'state', 'rowstate'],
    suffixes: ['status'],
    alignment: 'center',
  },
  {
    id: 'datetime',
    category: 'datetime',
    aliases: [
      'tradetime', 'ordertime', 'expiretime', 'marktime', 'pricetime',
      'quotetime', 'enteredtime', 'lastmodtime', 'lastticktime', 'tracetimestamp',
      'timestamp', 'lastupdate', 'lastupdated', 'updatedat', 'createdat', 'asoftime',
    ],
    suffixes: ['time', 'timestamp', 'datetime'],
    format: 'yyyy-mm-dd hh:nn:ss',
    alignment: 'left',
  },
  {
    id: 'date',
    category: 'date',
    aliases: [
      'date', 'maturity', 'maturitydate', 'tradedate', 'settledate',
      'settlementdate', 'issuedate', 'dateddate', 'firstcpndate', 'nextcpndate',
      'nextcalldate', 'workoutdate', 'auctiondate', 'ratingdate', 'exdivdate',
      'valuedate', 'effectivedate', 'expiry', 'expirydate',
    ],
    suffixes: ['date', 'maturity'],
    format: 'yyyy-mm-dd',
    alignment: 'left',
  },
  // Currency code columns — leave text, but centre common CCY fields.
  {
    id: 'ccy',
    category: 'identifier',
    aliases: ['ccy', 'currency', 'currencycode', 'curr', 'settleccy', 'tradedccy'],
    suffixes: ['ccy'],
    alignment: 'center',
  },
];
