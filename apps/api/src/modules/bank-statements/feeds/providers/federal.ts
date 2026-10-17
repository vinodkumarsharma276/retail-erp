import { FeedNotReadyError, type FeedProvider } from './types.js';

/**
 * Federal Bank — Account Statement API (corporate API banking).
 *
 * NOT YET IMPLEMENTED. Federal Bank publishes the request/response format only
 * inside its developer portal (https://developer.federal.bank.in, sign-in
 * required), so the exact contract is unknown here and nothing is guessed.
 *
 * To finish this provider, the bank's onboarding pack needs to supply:
 *   1. Sandbox + production base URLs, and the statement endpoint path/method.
 *   2. Auth: client id/secret headers, OAuth token flow, and/or mutual-TLS
 *      certificates; any request signing or payload encryption (JWE/AES).
 *   3. Request fields: account number, from/to dates (format), paging.
 *   4. Response fields per transaction: date, narration, debit/credit amount or
 *      Dr/Cr flag, running balance, reference / cheque number; date-range and
 *      rate limits.
 *   5. The server IP(s) to whitelist on their side.
 * Then implement `fetchTransactions` to call the API and map each entry to
 * { date: 'YYYY-MM-DD', description, amount (negative = debit), balance, reference },
 * set `ready: true`, and adjust `credentialFields` to what the bank issues.
 * Everything else (connect, sync, de-duplication, categorising, review) already works.
 */
export const federalProvider: FeedProvider = {
  id: 'federal',
  label: 'Federal Bank API',
  banks: ['Federal Bank'],
  ready: false,
  note: "Waiting for Federal Bank's API specification and production access. Use the Demo feed to try syncing meanwhile.",
  credentialFields: [
    { key: 'clientId', label: 'Client ID', secret: false },
    { key: 'clientSecret', label: 'Client secret', secret: true },
  ],
  async fetchTransactions() {
    throw new FeedNotReadyError("Federal Bank's statement API isn't set up in RetailERP yet (waiting for the bank's API specification).");
  },
};
