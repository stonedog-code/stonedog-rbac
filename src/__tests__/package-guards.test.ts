/**
 * The three publish guards, proven in BOTH directions (PRD-0067 R-S0, R-S2,
 * R-S3). A guard that has only ever been observed passing has been run, not
 * tested — so each one here is fed a planted failure, the plant is printed,
 * the refusal is read, and then the healthy input is shown to pass.
 *
 * The guards are plain Node scripts so `npm run gate` and the publish script
 * can call them with no build; this suite spawns them exactly as those do.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ESM under ts-jest: no __dirname.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = (name: string) => join(ROOT, "scripts", name);

function run(name: string, args: string[]) {
  const r = spawnSync(process.execPath, [script(name), ...args], { encoding: "utf8", cwd: ROOT });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "rbac-guards-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const healthyManifest = {
  name: "@stonedogcode/rbac",
  version: "0.2.0",
  license: "Apache-2.0",
  publishConfig: { access: "public" },
};

describe("check-manifest (R-S0)", () => {
  it("passes the real manifest and says what it examined", () => {
    const r = run("check-manifest.mjs", []);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 runtime dependencies/);
  });

  it("PLANTED: refuses a runtime dependency, naming it", () => {
    const file = join(work, "package.json");
    writeFileSync(file, JSON.stringify({ ...healthyManifest, dependencies: { leftpad: "^1.0.0" } }));
    const r = run("check-manifest.mjs", [file]);
    console.log(`[plant] ${file}: dependencies.leftpad`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ZERO runtime dependencies and now has 1: leftpad/);
  });

  it.each([
    ["an unscoped name", { name: "stonedog-rbac" }, /expected "@stonedogcode\/rbac"/],
    ["restricted access", { publishConfig: { access: "restricted" } }, /expected "public"/],
    ["a different licence", { license: "MIT" }, /expected Apache-2.0/],
    ["a prerelease version", { version: "0.2.0-rc.1" }, /not a plain semver release/],
  ])("PLANTED: refuses %s", (_what, override, expected) => {
    const file = join(work, "package.json");
    writeFileSync(file, JSON.stringify({ ...healthyManifest, ...override }));
    expect(run("check-manifest.mjs", [file])).toMatchObject({ code: 1 });
    expect(run("check-manifest.mjs", [file]).out).toMatch(expected);
  });
});

describe("check-tarball-leaks (R-S3)", () => {
  function fixture(files: Record<string, string>): string {
    const dir = join(work, "package");
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  }

  it("passes the package as it ships, and counts the files it examined", () => {
    const r = run("check-tarball-leaks.mjs", []);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/examined (\d+) file\(s\)/);
    const examined = Number(/examined (\d+) file/.exec(r.out)?.[1]);
    expect(examined).toBeGreaterThanOrEqual(5); // package.json, README, src/*.ts
  });

  it("PLANTED: a product role name in CODE is refused, with the file and line", () => {
    const dir = fixture({
      "package.json": "{}",
      "README.md": "# fine\n",
      "src/index.ts": 'export const staff = "System Admin";\n',
    });
    const r = run("check-tarball-leaks.mjs", ["--dir", dir]);
    console.log(`[plant] ${dir}/src/index.ts:1 System Admin (in code)`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src\/index\.ts:1\s+System Admin/);
  });

  it("the SAME name in a code COMMENT is allowed — the rationale may use the banned words", () => {
    const dir = fixture({
      "package.json": "{}",
      "README.md": "# fine\n",
      "src/index.ts": '// e.g. "System Admin" in a product\n/* Brand Admin (89) */\nexport const x = 1; // https://example.test/api/x\n',
    });
    const r = run("check-tarball-leaks.mjs", ["--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/examined 3 file\(s\)/);
  });

  it("PLANTED: a banned term AFTER `//` inside a STRING is still seen — formatting is not a bypass", () => {
    const dir = fixture({
      "package.json": "{}",
      "README.md": "# fine\n",
      "src/index.ts": 'export const p = "folder//System Admin";\nexport const u = "https://example.test/x"; // ok\n',
    });
    const r = run("check-tarball-leaks.mjs", ["--dir", dir]);
    console.log(`[plant] ${dir}/src/index.ts:1 System Admin (inside a string, after //)`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src\/index\.ts:1\s+System Admin/);
    expect(r.out).not.toMatch(/src\/index\.ts:2/);
  });

  it.each([
    ["an issue id in the README", "README.md", "See NEH-1878 for why.\n", /issue-tracker id \(NEH-1878\)/],
    ["a table name in JSON", "package.json", '{"x":"time_sensitive_token"}', /time_sensitive_token/],
    ["an internal hostname", "README.md", "host: db.chk08w46elwo.us-west-2.rds.amazonaws.com\n", /amazonaws\.com/],
    ["a permission level beside a role", "README.md", "Brand Admin (89) is a customer\n", /permission level beside a role/],
    ["an API route in code", "src/index.ts", 'export const path = "/api/auth/passpin";\n', /API route/],
  ])("PLANTED: %s is refused", (_what, file, body, expected) => {
    const base: Record<string, string> = { "package.json": "{}", "README.md": "# fine\n", "src/index.ts": "export const x = 1;\n" };
    const dir = fixture({ ...base, [file]: body });
    const r = run("check-tarball-leaks.mjs", ["--dir", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(expected);
  });

  it("refuses an EMPTY package rather than passing over nothing", () => {
    const dir = join(work, "package");
    mkdirSync(dir, { recursive: true });
    const r = run("check-tarball-leaks.mjs", ["--dir", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/examined 0 files/);
  });
});

describe("check-secrets (R-S2)", () => {
  it("passes every tracked file and says how many", () => {
    const r = run("check-secrets.mjs", []);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/examined \d+ file\(s\); 0 credential-shaped values/);
  });

  it("PLANTED: an AWS key id is refused, located, and MASKED in the output", () => {
    const planted = `AKIA${"Q".repeat(16)}`;
    const file = join(work, "config.ts");
    writeFileSync(file, `export const key = "${planted}";\n`);
    const r = run("check-secrets.mjs", ["--paths", file]);
    console.log(`[plant] ${file}:1 AWS access key id`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/config\.ts:1\s+AWS access key id/);
    expect(r.out).not.toContain(planted);
    expect(r.out).toContain("AKIA");
  });

  it.each([
    ["a private key block", "-----BEGIN RSA PRIVATE KEY-----\nabc\n", /private key block/],
    ["an npm token", `token=npm_${"a1B2".repeat(10)}\n`, /npm token/],
    ["a connection string carrying a password", "DATABASE=postgresql://app:hunter22@db.internal:5432/x\n", /connection string with a password/],
    ["an assigned secret literal", 'const apiKey = "sk-this-is-a-long-literal-value-1234";\n', /assigned secret literal/],
  ])("PLANTED: %s is refused", (_what, body, expected) => {
    const file = join(work, "planted.txt");
    writeFileSync(file, body);
    const r = run("check-secrets.mjs", ["--paths", file]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(expected);
  });

  it("an ordinary file passes, and the set size is reported", () => {
    const file = join(work, "ok.ts");
    writeFileSync(file, 'export const greeting = "hello";\n');
    const r = run("check-secrets.mjs", ["--paths", file]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/examined 1 file\(s\); 0 credential-shaped values/);
  });
});
