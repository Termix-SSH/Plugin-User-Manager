import { describe, expect, it } from "vitest";
import {
  checkNewKey,
  fingerprint,
  parseDetail,
  parseKeyLine,
  parseList,
  parseSessions,
  parseStatus,
  passwordState,
} from "../../src/backend/parse.js";
import { LIST } from "./fixtures";

describe("status", () => {
  it("reads the sudo group, shells and uid start", () => {
    expect(
      parseStatus(
        "os=Debian\nuser=deploy\nroot=1\nsudogroup=sudo\nuidmin=1000\ntools=1\nshell=/bin/bash\nshell=/bin/sh\n",
      ),
    ).toEqual({
      os: "Debian",
      user: "deploy",
      root: true,
      sudoGroup: "sudo",
      shells: ["/bin/bash", "/bin/sh"],
      uidMin: 1000,
      tools: true,
    });
  });
});

describe("password state", () => {
  it("reads shadow fields", () => {
    expect(passwordState("$y$hash")).toBe("set");
    expect(passwordState("!$y$hash")).toBe("locked");
    expect(passwordState("*")).toBe("none");
    expect(passwordState("!")).toBe("none");
    expect(passwordState("!!")).toBe("none");
    expect(passwordState("")).toBe("empty");
    expect(passwordState(undefined)).toBe("unknown");
  });
});

describe("list", () => {
  const { users, groups } = parseList(LIST, 1000);
  const byName = (name: string) => users.find((u) => u.name === name)!;

  it("reads users with groups, sudo and state", () => {
    expect(byName("deploy")).toMatchObject({
      uid: 1000,
      group: "deploy",
      comment: "Deploy User",
      groups: ["sudo", "docker"],
      sudo: true,
      self: true,
      system: false,
      password: "set",
      expired: false,
      canLogin: true,
    });
    expect(byName("alice")).toMatchObject({
      sudo: false,
      password: "empty",
      groups: ["docker", "devs"],
    });
    expect(byName("old")).toMatchObject({ password: "locked", expired: true });
    expect(byName("root")).toMatchObject({ sudo: true, system: false });
    expect(byName("daemon")).toMatchObject({ system: true, canLogin: false });
    expect(byName("nobody").system).toBe(true);
  });

  it("knows whose main group each group is", () => {
    const alice = groups.find((g) => g.name === "alice")!;
    expect(alice.primaryOf).toEqual(["alice"]);
    expect(groups.find((g) => g.name === "devs")).toMatchObject({
      members: ["alice"],
      primaryOf: [],
      system: false,
    });
    expect(groups.find((g) => g.name === "docker")!.system).toBe(true);
  });

  it("marks passwords unknown without shadow", () => {
    const noShadow = LIST.replace(
      /@@TERMIX@@SHADOW[\s\S]*?(?=@@TERMIX@@ME)/,
      "",
    );
    expect(parseList(noShadow, 1000).users[0].password).toBe("unknown");
  });
});

describe("keys", () => {
  const blob =
    "AAAAC3NzaC1lZDI1NTE5AAAAIGv2r0JpQ5bKcVqk0vF1XxM7j3VYw0X5mZr9m9wq3d1H";

  it("reads lines with options and comments", () => {
    expect(parseKeyLine(`ssh-ed25519 ${blob} alice@laptop`, 3)).toEqual({
      line: 3,
      type: "ssh-ed25519",
      fingerprint: fingerprint(blob),
      comment: "alice@laptop",
      options: false,
    });
    expect(
      parseKeyLine(`from="10.0.0.0/8",no-pty ssh-ed25519 ${blob} ci`, 0)
        ?.options,
    ).toBe(true);
    expect(parseKeyLine("# comment", 0)).toBeNull();
    expect(parseKeyLine("garbage", 0)).toBeNull();
  });

  it("makes OpenSSH style fingerprints", () => {
    expect(fingerprint(blob)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it("only accepts plain public keys", () => {
    expect(checkNewKey(`  ssh-ed25519 ${blob} me  `)).toBe(
      `ssh-ed25519 ${blob} me`,
    );
    expect(() => checkNewKey("ssh-ed25519")).toThrow();
    expect(() =>
      checkNewKey(`command="rm -rf /" ssh-ed25519 ${blob}`),
    ).toThrow();
    expect(() =>
      checkNewKey(`ssh-ed25519 ${blob}\nssh-ed25519 ${blob}`),
    ).toThrow();
  });

  it("reads detail output", () => {
    const detail = parseDetail(
      `@@TERMIX@@LAST\nalice  pts/0  10.0.0.5  Mon Nov  3 10:00:00 +0000 2026\n@@TERMIX@@KEYS\nssh-ed25519 ${blob} a\n`,
    );
    expect(detail.lastLogin).toContain("pts/0");
    expect(detail.keys).toHaveLength(1);
    expect(detail.keysError).toBe("");
    expect(
      parseDetail(
        "@@TERMIX@@LAST\n**Never logged in**\n@@TERMIX@@KEYS\n@@TERMIX@@DENIED\n",
      ),
    ).toMatchObject({
      lastLogin: "",
      keysError: "denied",
    });
  });
});

describe("sessions", () => {
  it("reads who", () => {
    expect(
      parseSessions(
        "@@TERMIX@@WHO\ndeploy   pts/0        2026-11-04 10:00 (100.64.0.1)\n@@TERMIX@@LAST\ndeploy pts/0 100.64.0.1 Tue Nov  4 10:00   still logged in\n",
      ),
    ).toEqual({
      sessions: [
        {
          user: "deploy",
          tty: "pts/0",
          since: "2026-11-04 10:00",
          from: "100.64.0.1",
        },
      ],
      recent: ["deploy pts/0 100.64.0.1 Tue Nov  4 10:00   still logged in"],
    });
    expect(
      parseSessions(
        "@@TERMIX@@WHO\ndeploy sshd         Nov  5 04:04 (192.168.1.3)\n",
      ).sessions[0],
    ).toEqual({
      user: "deploy",
      tty: "sshd",
      since: "Nov  5 04:04",
      from: "192.168.1.3",
    });
  });
});
