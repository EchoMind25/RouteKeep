import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Emails the app wrote with EMAIL_PROVIDER=log (the default with AUTH_MODE=local).
const MAIL = ".local/mail";

export async function mailTo(address: string, subject: RegExp, after = 0): Promise<{ text: string; subject: string }> {
  for (let i = 0; i < 40; i++) {
    const files = (await readdir(MAIL).catch(() => [] as string[])).sort();
    for (const f of files.reverse()) {
      if (Number(f.split("-")[0]) < after) continue;
      const m = JSON.parse(await readFile(join(MAIL, f), "utf8")) as { to: string; subject: string; text: string };
      if (m.to === address && subject.test(m.subject)) return m;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${address} matching ${subject}`);
}

/** Links in emails use APP_URL; the test server may listen elsewhere, so keep only path and query. */
export function linkIn(text: string, re: RegExp): string {
  const url = new URL(re.exec(text)![0]);
  return `${url.pathname}${url.search}`;
}
