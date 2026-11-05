import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";
import { LIST } from "./fixtures";

let s: TestServer | null = null;

afterEach(async () => {
  await s?.close();
  s = null;
});

const STATUS =
  "os=Debian\nuser=deploy\nroot=1\nsudogroup=sudo\nuidmin=1000\ntools=1\nshell=/bin/bash\nshell=/bin/zsh\n";
const KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGv2r0JpQ5bKcVqk0vF1XxM7j3VYw0X5mZr9m9wq3d1H alice@laptop";

async function server(options: Parameters<typeof startServer>[0] = {}) {
  const srv = await startServer(options);
  srv.ssh.replies.push({ match: "sudogroup=", stdout: STATUS });
  srv.ssh.replies.push({ match: "@@TERMIX@@PASSWD", stdout: LIST });
  srv.ssh.replies.push({
    match: "@@TERMIX@@LAST",
    stdout: `@@TERMIX@@LAST\n@@TERMIX@@KEYS\n${KEY}\n`,
  });
  return srv;
}

const decoded = (stdin: string) => {
  const match = stdin.match(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d/);
  return match ? Buffer.from(match[1], "base64").toString() : "";
};

describe("reads", () => {
  it("lists users and groups", async () => {
    s = await server();
    const res = await s.request("GET", "/1/users");
    expect(res.status).toBe(200);
    expect(
      res.body.users.find((u: { name: string }) => u.name === "deploy").self,
    ).toBe(true);
    expect(res.body.groups.length).toBeGreaterThan(3);
  });

  it("refuses bad user names", async () => {
    s = await server();
    expect((await s.request("GET", "/1/users/a;b")).status).toBe(400);
    expect((await s.request("GET", "/1/users/Root")).status).toBe(400);
  });

  it("refuses hosts with Users off", async () => {
    s = await server({ settings: { enableUsers: false } });
    expect((await s.request("GET", "/1/users")).body.code).toBe("disabled");
  });
});

describe("changes", () => {
  it("creates a user with sudo and a password sent on stdin", async () => {
    s = await server();
    const res = await s.request("POST", "/1/users", {
      name: "bob",
      comment: "Bob",
      shell: "/bin/zsh",
      groups: ["docker"],
      sudo: true,
      password: "s3cret pass",
    });
    expect(res.status).toBe(200);
    const call = s.ssh.calls.find((c) => c.stdin.includes("useradd -m"))!;
    expect(call.command).toContain("sudo");
    expect(call.stdin).toContain(
      "useradd -m -s '/bin/zsh' -c 'Bob' -G 'docker,sudo' 'bob'",
    );
    expect(call.stdin).not.toContain("s3cret");
    expect(decoded(call.stdin)).toBe("bob:s3cret pass");
    expect(JSON.stringify(s.mock.audits)).not.toContain("s3cret");
  });

  it("refuses a shell that is not in /etc/shells", async () => {
    s = await server();
    const res = await s.request("POST", "/1/users", {
      name: "bob",
      shell: "/tmp/evil",
    });
    expect(res.status).toBe(400);
  });

  it("guards root and the login user in the script", async () => {
    s = await server();
    await s.request("DELETE", "/1/users/alice?removeHome=1");
    const call = s.ssh.calls.at(-1)!;
    expect(call.stdin).toContain("me=${SUDO_USER:-$(id -un)}");
    expect(call.stdin).toContain("userdel -r 'alice'");
  });

  it("locks with an expiry so keys stop too", async () => {
    s = await server();
    await s.request("POST", "/1/users/alice/lock", { locked: true });
    expect(s.ssh.calls.at(-1)!.stdin).toContain("usermod -L -e 1 'alice'");
    await s.request("POST", "/1/users/alice/lock", { locked: false });
    expect(s.ssh.calls.at(-1)!.stdin).toContain("usermod -e '' 'alice'");
  });

  it("gives sudo through the sudo group", async () => {
    s = await server();
    await s.request("POST", "/1/users/alice/sudo", { sudo: true });
    expect(s.ssh.calls.at(-1)!.stdin).toContain("gpasswd -a 'alice' 'sudo'");
  });

  it("adds a key and keeps the others", async () => {
    s = await server();
    const other = KEY.replace("alice@laptop", "phone");
    const res = await s.request("POST", "/1/users/alice/keys", { key: other });
    expect(res.status).toBe(200);
    const write = s.ssh.calls.find((c) =>
      c.stdin.includes('authorized_keys"\nrm'),
    )!;
    expect(decoded(write.stdin)).toBe(`${KEY}\n${other}\n`);
    expect(write.stdin).toContain('[ -L "$h/.ssh" ]');
  });

  it("removes a key only when the fingerprint matches", async () => {
    s = await server();
    const detail = (await s.request("GET", "/1/users/alice")).body;
    const key = detail.keys[0];
    const wrong = await s.request(
      "DELETE",
      `/1/users/alice/keys/${key.line}?fingerprint=SHA256:nope`,
    );
    expect(wrong.status).toBe(409);
    const ok = await s.request(
      "DELETE",
      `/1/users/alice/keys/${key.line}?fingerprint=${encodeURIComponent(key.fingerprint)}`,
    );
    expect(ok.status).toBe(200);
  });

  it("refuses to delete a group that is someone's main group", async () => {
    s = await server();
    const res = await s.request("DELETE", "/1/groups/alice");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("main group");
  });

  it("needs edit access and a writable host", async () => {
    s = await server({ level: "connect" });
    expect(
      (await s.request("POST", "/1/users/alice/lock", { locked: true })).body
        .code,
    ).toBe("HOST_EDIT_REQUIRED");
    await s.close();
    s = await server({ settings: { readOnly: true } });
    expect(
      (await s.request("POST", "/1/users/alice/lock", { locked: true })).body
        .code,
    ).toBe("readOnly");
  });
});

describe("scripts", () => {
  const bash = spawnSync("bash", ["-c", "true"]).status === 0;

  it.skipIf(!bash)("every script parses as bash", async () => {
    s = await server();
    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/1/status"],
      ["GET", "/1/users"],
      ["GET", "/1/users/alice"],
      ["GET", "/1/sessions"],
      [
        "POST",
        "/1/users",
        { name: "bob", password: 'it\'s "x" $y', groups: ["docker"] },
      ],
      [
        "PUT",
        "/1/users/alice",
        { comment: "A l'ice", shell: "/bin/bash", groups: [] },
      ],
      ["POST", "/1/users/alice/password", { password: "p'w" }],
      ["POST", "/1/users/alice/lock", { locked: true }],
      ["POST", "/1/users/alice/lock", { locked: false }],
      ["POST", "/1/users/alice/expire-password"],
      ["POST", "/1/users/alice/sudo", { sudo: false }],
      ["DELETE", "/1/users/alice?removeHome=1"],
      ["POST", "/1/users/alice/keys", { key: KEY }],
      ["POST", "/1/groups", { name: "devs2" }],
      ["DELETE", "/1/groups/devs"],
      ["POST", "/1/groups/devs/members", { user: "deploy", member: true }],
    ];
    for (const [method, path, body] of calls) {
      await s.request(method, path, body);
    }
    expect(s.ssh.calls.length).toBeGreaterThan(15);
    for (const call of s.ssh.calls) {
      const out = spawnSync("bash", ["-n"], { input: call.stdin });
      expect(out.status, `${call.stdin}\n${out.stderr}`).toBe(0);
    }
  });
});
