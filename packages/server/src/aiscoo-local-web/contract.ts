export interface LocalWebOptions {
  /** Exact HTTP loopback page origins with explicit ports. No implicit origins are trusted. */
  allowedOrigins: readonly string[];
}
