import { load, lock, onStatus, status, ping } from "./store.js";
import { h, clear } from "./ui.js";
import * as home from "./tools/home.js";
import * as acronyms from "./tools/acronyms.js";
import * as workstreams from "./tools/workstreams.js";
import * as events from "./tools/events.js";
import * as links from "./tools/links.js";

export const tools = [acronyms, workstreams, events, links];
const routes = [home, ...tools];
const main = document.getElementById("main");
const nav = document.getElementById("nav");
const statusEl = document.getElementById("status");
const lockButton = document.getElementById("lock");

function renderStatus() {
  statusEl.textContent = status.writable ? "" : "Offline - read only";
  statusEl.className = "status" + (status.writable ? "" : " offline");
}

function route() {
  if (!status.loaded) return;
  const id = location.hash.replace(/^#\/?/, "").split("/")[0] || "home";
  const tool = routes.find((t) => t.meta.id === id) || home;
  document.title = (tool === home ? "" : tool.meta.title + " - ") + "SPR Tools";
  clear(nav).append(
    ...[home, ...tools].map((t) =>
      h(
        "a",
        {
          href: t === home ? "#/" : "#/" + t.meta.id,
          "aria-current": t === tool ? "page" : null,
        },
        t.meta.title,
      ),
    ),
  );
  clear(main);
  tool.render(main);
  main.focus({ preventScroll: true });
}

onStatus(renderStatus);
window.addEventListener("hashchange", route);
window.addEventListener("focus", ping);
window.addEventListener("online", ping);

function showUnlock() {
  nav.hidden = true;
  lockButton.hidden = true;
  statusEl.textContent = "";
  const password = h("input", {
    type: "password",
    required: true,
    autocomplete: "current-password",
  });
  const feedback = h("div", {
    class: "error-summary",
    role: "alert",
    hidden: true,
  });
  const submit = h("button", { class: "primary", type: "submit" }, "Unlock");
  const form = h(
    "form",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        feedback.hidden = true;
        try {
          await load(password.value);
          password.value = "";
          nav.hidden = false;
          lockButton.hidden = false;
          renderStatus();
          route();
        } catch (error) {
          feedback.textContent = error.message;
          feedback.hidden = false;
          password.select();
        } finally {
          submit.disabled = false;
        }
      },
    },
    feedback,
    h("div", { class: "field" }, h("label", null, "Passphrase"), password),
    submit,
  );
  main.replaceChildren(
    h(
      "section",
      { class: "card" },
      h("h1", null, "Unlock SPR Tools"),
      h(
        "p",
        null,
        "Enter the shared passphrase to decrypt the data on this device.",
      ),
      form,
    ),
  );
  password.focus();
}

lockButton.addEventListener("click", () => {
  lock();
  showUnlock();
});

showUnlock();

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
