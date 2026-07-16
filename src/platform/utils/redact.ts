// Every quantifier is upper-bounded so global-scan matching stays linear — an
// unbounded `+` over these classes is O(n²) on adversarial input (a ReDoS).
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE = /(?<!\d)(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const CREDIT_CARD = /\b(?:\d[ -]?){13,19}\b/g;
const API_KEY = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,256}\b/g;
const AWS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,512}\.[A-Za-z0-9_-]{10,512}\.[A-Za-z0-9_-]{10,512}\b/g;

function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactPII(text: string): string {
  return text
    .replace(JWT, "[REDACTED_KEY]")
    .replace(AWS_KEY, "[REDACTED_KEY]")
    .replace(API_KEY, "[REDACTED_KEY]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(SSN, "[REDACTED_SSN]")
    .replace(CREDIT_CARD, (match) => (passesLuhn(match) ? "[REDACTED_CC]" : match))
    .replace(IPV4, "[REDACTED_IP]")
    .replace(PHONE, "[REDACTED_PHONE]");
}

export function redactPiiEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.REDACT_PII?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}
