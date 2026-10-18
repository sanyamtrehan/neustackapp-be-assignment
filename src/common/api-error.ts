/** The body returned by every failed request. */
export class ApiError {
  /**
   * Stable machine-readable code a client can branch on, such as
   * `INSUFFICIENT_INVENTORY`. Codes do not change once published.
   */
  code: string;

  /** Human readable explanation. Wording may change; the code will not. */
  message: string;
}
