/**
 * Strip credential material from error text before it reaches the model, the
 * host, the audit file or stderr. Upstream HTTP errors can echo request
 * headers or URLs with embedded secrets.
 */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/(authorization\s*[:=]\s*)(?:basic|bearer)?\s*[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\n"']+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|passphrase|client_secret|clientsecret|sap-password|token|api[_-]?key|secret|lock_?handle)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\/\s:@]+:[^\/\s:@]+@/gi, '$1[REDACTED]@');
}
