import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identities } from "./identity";
import { store } from "./store";
export function testAccount(subject = "test") {
  const user = identities().login({
    provider: "google",
    subject,
    email: `${subject}@example.test`,
    emailVerified: true,
    name: subject,
  });
  return { user, token: identities().issue(user.id, "device").token };
}
export function testEnvironment() {
  const previous = {
    directory: process.env.DOOMPILE_DATA_DIR,
    storage: process.env.DOOMPILE_STORAGE,
  };
  const directory = mkdtempSync(join(tmpdir(), "doompile-auth-test-"));
  process.env.DOOMPILE_DATA_DIR = directory;
  process.env.DOOMPILE_STORAGE = "filesystem";
  const accounts: ReturnType<typeof testAccount>[] = [];
  return {
    directory,
    account(subject = "test") {
      const account = testAccount(subject);
      accounts.push(account);
      return account;
    },
    cleanup() {
      for (const account of accounts) store(account.user.id).close();
      identities().close();
      rmSync(directory, { recursive: true, force: true });
      if (previous.directory === undefined)
        delete process.env.DOOMPILE_DATA_DIR;
      else process.env.DOOMPILE_DATA_DIR = previous.directory;
      if (previous.storage === undefined) delete process.env.DOOMPILE_STORAGE;
      else process.env.DOOMPILE_STORAGE = previous.storage;
    },
  };
}
