const ANSI = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])",
  "g",
);

export function stripAnsi(frame: string | undefined): string {
  return (frame ?? "").replace(ANSI, "");
}
