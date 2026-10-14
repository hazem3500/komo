import type { CommentsApi } from "./api.js";
import { selectionMenu } from "./action-menu.js";
import { button, el, icon } from "./dom.js";

type ProjectDetails = {
  project: string;
  access: "public" | "private";
  hosted: boolean;
  members: { id: string; name: string; email?: string }[];
  invites: { email: string }[];
};
type WebhookSettings = {
  url: string;
  events: string[];
  enabled: boolean;
  secretConfigured: boolean;
  deliveryAvailable: boolean;
  supportedEvents: string[];
};
export function projectManagement(
  api: CommentsApi,
  workspace?: string,
  onChange?: (deleted: boolean) => void
) {
  const panel = el("section", "account-sites project-management");
  panel.dataset.open = "false";
  const summary = button(
    "Project settings",
    () => {
      const open = panel.dataset.open !== "true";
      panel.dataset.open = String(open);
      summary.setAttribute("aria-expanded", String(open));
      reveal.inert = !open;
      reveal.setAttribute("aria-hidden", String(!open));
    },
    "account-sites-summary"
  );
  summary.append(icon("chevron"));
  summary.setAttribute("aria-expanded", "false");
  const reveal = el("div", "account-sites-reveal");
  reveal.id = `project-settings-${crypto.randomUUID()}`;
  summary.setAttribute("aria-controls", reveal.id);
  reveal.inert = true;
  reveal.setAttribute("aria-hidden", "true");
  const clip = el("div", "account-sites-clip");
  reveal.append(clip);
  const content = el("div", "account-sites-content");
  const status = el("p", "account-usage-status");
  status.setAttribute("role", "status");
  const suffix = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  const request = <T>(path: string, method = "GET", data?: unknown) =>
    api.request<T>(`project${path}${suffix}`, method, data);
  panel.hidden = true;
  clip.append(content, status);
  panel.append(summary, reveal);
  const action = async (work: () => Promise<void>) => {
    const buttons = Array.from(panel.querySelectorAll("button"));
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = "";
    try {
      await work();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Try again.";
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };
  const download = async () => {
    const snapshot: {
      format: string;
      version: number;
      project: string;
      exportedAt: string;
      tables: Record<string, unknown[]>;
    } = {
      format: "komo-export",
      version: 1,
      project: details!.project,
      exportedAt: new Date().toISOString(),
      tables: {},
    };
    let revision: number | undefined;
    for (const table of ["threads", "comments", "reactions", "users"]) {
      snapshot.tables[table] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page: { rows: unknown[]; next: number | null; revision: number } =
          await api.request(
            `project/export?table=${table}&offset=${offset}${revision === undefined ? "" : `&revision=${revision}`}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}`
          );
        revision = page.revision;
        snapshot.tables[table].push(...page.rows);
        offset = page.next;
      }
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      })
    );
    const link = el("a");
    link.href = url;
    link.download = `${details!.project}-comments.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Export downloaded.";
  };
  let details: ProjectDetails;
  const load = async () => {
    details = await request<ProjectDetails>("");
    panel.hidden = false;
    content.replaceChildren();
    const accessLabel = el("div", "account-name-label");
    accessLabel.append(el("span", "", "Access"));
    const accessChoices = [
      ["public", "Anyone with the link"],
      ["private", "Invited Google accounts"],
    ] as const;
    let access: HTMLElement;
    const drawAccess = () => {
      const next = selectionMenu(
        "Project access",
        accessChoices,
        details.access,
        (value) =>
          void action(async () => {
            const previous = details.access;
            details.access = value as ProjectDetails["access"];
            drawAccess();
            try {
              await request("", "PATCH", { access: value });
              status.textContent = "Access updated.";
            } catch (error) {
              details.access = previous;
              drawAccess();
              throw error;
            }
          })
      );
      if (access) access.replaceWith(next);
      else accessLabel.append(next);
      access = next;
    };
    drawAccess();
    content.append(accessLabel);
    const webhook = await request<WebhookSettings>("/webhook");
    const webhookPanel = el("details", "project-webhook");
    webhookPanel.append(el("summary", "", "Comment webhooks"));
    const webhookDescription = el(
      "p",
      "project-help",
      "Send signed events to your HTTPS endpoint. Signing secrets are encrypted and shown only when entered."
    );
    webhookPanel.append(webhookDescription);
    if (!webhook.deliveryAvailable) {
      webhookDescription.textContent =
        "Secure webhook delivery is not available on this server yet.";
    }
    const webhookUrlLabel = el("label", "account-name-label", "HTTPS endpoint");
    const webhookUrl = el("input");
    webhookUrl.type = "url";
    webhookUrl.autocomplete = "off";
    webhookUrl.placeholder = "https://example.com/komo-webhook";
    webhookUrl.value = webhook.url;
    webhookUrlLabel.append(webhookUrl);
    webhookPanel.append(webhookUrlLabel);
    const webhookSecretLabel = el(
      "label",
      "account-name-label",
      webhook.secretConfigured ? "Replace signing secret" : "Signing secret"
    );
    const webhookSecret = el("input");
    webhookSecret.type = "password";
    webhookSecret.autocomplete = "new-password";
    webhookSecret.minLength = 32;
    webhookSecret.maxLength = 256;
    webhookSecretLabel.append(webhookSecret);
    webhookPanel.append(webhookSecretLabel);
    const eventInputs = new Map<string, HTMLInputElement>();
    for (const eventName of webhook.supportedEvents) {
      const label = el("label", "account-name-label", eventName);
      const checkbox = el("input");
      checkbox.type = "checkbox";
      checkbox.checked = webhook.events.includes(eventName);
      eventInputs.set(eventName, checkbox);
      label.prepend(checkbox);
      webhookPanel.append(label);
    }
    const webhookEnabledLabel = el("label", "account-name-label", "Enable delivery");
    const webhookEnabled = el("input");
    webhookEnabled.type = "checkbox";
    webhookEnabled.checked = webhook.enabled;
    webhookEnabled.disabled = !webhook.deliveryAvailable && !webhook.enabled;
    webhookEnabledLabel.prepend(webhookEnabled);
    webhookPanel.append(webhookEnabledLabel);
    webhookPanel.append(
      button(
        "Save webhook settings",
        () =>
          void action(async () => {
            await request("/webhook", "PATCH", {
              url: webhookUrl.value,
              secret: webhookSecret.value,
              events: [...eventInputs]
                .filter(([, input]) => input.checked)
                .map(([eventName]) => eventName),
              enabled: webhookEnabled.checked,
            });
            webhookSecret.value = "";
            status.textContent = "Webhook settings saved.";
          }),
        "secondary"
      )
    );
    content.append(webhookPanel);
    const emailLabel = el("label", "account-name-label", "Invite someone");
    const email = el("input");
    email.type = "email";
    email.placeholder = "name@example.com";
    email.autocomplete = "email";
    emailLabel.append(email);
    const share = el("input");
    share.readOnly = true;
    share.hidden = true;
    share.setAttribute("aria-label", "Invitation link");
    const invite = button(
      "Create invitation",
      () =>
        void action(async () => {
          if (!email.checkValidity() || !email.value)
            throw Error("Enter an email address.");
          const result = await request<{ url: string }>("/invites", "POST", {
            email: email.value,
          });
          share.value = result.url;
          share.hidden = false;
          copy.hidden = false;
          status.textContent = "Share this link. It expires in 7 days.";
        }),
      "secondary"
    );
    const copy = button(
      "Copy invitation",
      () =>
        void action(async () => {
          await navigator.clipboard.writeText(share.value);
          status.textContent = "Invitation copied.";
        }),
      "secondary"
    );
    copy.hidden = true;
    content.append(emailLabel, invite, share, copy);
    for (const member of details.members) {
      const row = el("div", "project-member");
      row.append(
        el("span", "", member.name),
        button(
          `Remove ${member.name}`,
          () =>
            void action(async () => {
              await request("/members", "DELETE", { user: member.id });
              await load();
              status.textContent = "Member removed.";
            }),
          "secondary"
        )
      );
      content.append(row);
    }
    for (const pending of details.invites) {
      const row = el("div", "project-member");
      row.append(
        el("span", "", pending.email),
        button(
          "Revoke invitation",
          () =>
            void action(async () => {
              await request("/invites", "DELETE", { email: pending.email });
              await load();
              status.textContent = "Invitation revoked.";
            }),
          "secondary"
        )
      );
      content.append(row);
    }
    content.append(
      button("Download comments", () => void action(download), "secondary")
    );
    const migration = el("a", "project-help", "Move to self-hosting");
    migration.href = "https://komo.offbr.co/hosting/#migration";
    migration.target = "_blank";
    migration.rel = "noopener noreferrer";
    content.append(migration);
    const danger = el("details", "project-danger");
    danger.append(el("summary", "", "Free space or delete project"));
    danger.append(
      el(
        "p",
        "",
        `Export first. These actions permanently remove comments. Type ${details.project} to confirm.`
      )
    );
    const confirm = el("input");
    confirm.placeholder = details.project;
    confirm.setAttribute("aria-label", "Confirm project key");
    danger.append(confirm);
    danger.append(
      button(
        "Delete resolved threads",
        () =>
          void action(async () => {
            await request("/clear-resolved", "POST", {
              confirm: confirm.value,
            });
            onChange?.(false);
            status.textContent = "Resolved threads deleted.";
            confirm.value = "";
          }),
        "secondary destructive"
      )
    );
    if (details.hosted)
      danger.append(
        button(
          "Delete project",
          () =>
            void action(async () => {
              await request("", "DELETE", { confirm: confirm.value });
              onChange?.(true);
              content.replaceChildren();
              status.textContent =
                "Project deleted. Its project slot is available again.";
            }),
          "secondary destructive"
        )
      );
    content.append(danger);
  };
  void load().catch((error) => {
    if (error?.status !== 403) {
      panel.hidden = false;
      status.textContent = "Project settings unavailable.";
      content.append(button("Retry", () => void action(load), "secondary"));
    }
  });
  return panel;
}
