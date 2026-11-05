import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const status = {
  os: "Debian GNU/Linux 13",
  user: "deploy",
  root: true,
  sudoGroup: "sudo",
  shells: ["/bin/bash", "/bin/sh"],
  uidMin: 1000,
  tools: true,
  canEdit: true,
  readOnly: false,
};

const user = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  uid: 1000,
  gid: 1000,
  group: name,
  comment: "",
  home: `/home/${name}`,
  shell: "/bin/bash",
  groups: [],
  sudo: false,
  system: false,
  self: false,
  password: "set",
  expired: false,
  passwordChanged: "2026-01-01",
  canLogin: true,
  ...over,
});

const list = {
  users: [
    user("deploy", { self: true, sudo: true, groups: ["sudo"] }),
    user("alice", { uid: 1001, password: "empty" }),
    user("daemon", { uid: 1, system: true, canLogin: false }),
  ],
  groups: [
    { name: "sudo", gid: 27, members: ["deploy"], primaryOf: [], system: true },
    {
      name: "devs",
      gid: 1003,
      members: ["alice"],
      primaryOf: [],
      system: false,
    },
  ],
};

function api(current: unknown) {
  return {
    get: vi.fn(async (url: string) => ({
      data: url.endsWith("/status")
        ? current
        : url.endsWith("/users")
          ? list
          : url.includes("/users/")
            ? { lastLogin: "", loginKnown: true, keys: [], keysError: "" }
            : { sessions: [], recent: [] },
    })),
  } as never;
}

const host = { id: 1, name: "web", enableSsh: true };

describe(`${manifest.id} activate`, () => {
  it("registers the host tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["user-manager"]);
  });

  it("lists people with their badges and hides system accounts", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("user-manager", { isVisible: true, host });
    expect(await screen.findByText("deploy")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.queryByText("daemon")).toBeNull();
    expect(screen.getByText(locales.users.you)).toBeTruthy();
    expect(screen.getByText(locales.users.emptyPassword)).toBeTruthy();
  });

  it("opens a user and keeps root and self safe", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("user-manager", { isVisible: true, host });
    fireEvent.click(await screen.findByText("deploy"));
    expect(await screen.findByText(locales.keys.empty)).toBeTruthy();
    expect(screen.getByText(locales.detail.protected)).toBeTruthy();
    expect(screen.queryByText(locales.detail.delete)).toBeNull();
  });

  it("shows groups", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("user-manager", { isVisible: true, host });
    fireEvent.click(await screen.findByText(locales.tab.viewGroups));
    expect(await screen.findByText("devs")).toBeTruthy();
  });

  it("warns when changes need sudo", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({ ...status, root: false }),
    });
    rendered.renderTab("user-manager", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.sudo)).toBeTruthy();
    expect(screen.queryByText(locales.users.add)).toBeNull();
  });
});
