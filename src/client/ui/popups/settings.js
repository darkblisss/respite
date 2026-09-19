/* ============================================================
   Respite · popups/settings.js · The Ledger Keeper
   ------------------------------------------------------------
   Two dialogs. `settings`: who you are, how the connection
   stands, how saving works, and starting over. `account`: sign
   in or make an account. Signing in leaves a guest camp behind,
   so a guest with anything to lose is asked first.

   The switch from one camp to another is main.js's: it hears
   net's sign in and sign out and swaps the store, which closes
   these dialogs on its way.
   ============================================================ */

import { h, setAttr, setText, toggleClass } from "../dom.js";
import { iconEl } from "../icons.js";
import { confirm, openModal, toast } from "../overlay.js";
import { openPopup, registerPopup } from "../widgets.js";
import { fmtAgo, fmtWhole } from "../format.js";
import { hasProgress } from "../../store.js";
import { cleanUsername, passwordError, usernameError } from "../../net.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stat = (label, value) => h("div.stat", h("span.l", label), value);

/* ================= 1. SETTINGS ================= */

function connectionText(ctx) {
  const store = ctx.store;
  const st = store.status;
  if (st.conn === "guest") return ["Playing as a guest", "muted"];
  if (st.conn === "connecting") return ["Connecting", null];
  if (st.conn === "syncing") return ["Syncing", "tan"];
  if (st.conn === "outdated") return ["A new version is out", "bad"];
  if (st.conn === "offline") return [st.error === "unauthorized" ? "Signed out" : "Offline", "bad"];
  return [store.online != null ? `Online · ${fmtWhole(store.online)} in the realm` : "Online", "good"];
}

registerPopup("settings", (ctx) => {
  const offs = [];
  const acct = ctx.account;
  const guest = acct.mode !== "account";
  /* Names are stored lowercase; the camp shows them the way the Character page does.
     A Discord account's email is not one of ours, so the session carries no username
     and the server's own name (on the save) is the one to show. */
  const known = acct.username || ctx.state.meta.account || "";
  const name = known ? known.charAt(0).toUpperCase() + known.slice(1) : "Commander";
  let modal;

  /* ---- account ---- */
  let accountBody;
  if (guest) {
    accountBody = [
      h("div.banner",
        h("span.banner-ico", iconEl("cloud")),
        h("div.banner-text", h("b", "Playing as a guest"), "Nothing is kept. Sign in, or make an account, and the server keeps your camp.")),
      h("div.set-actions",
        h("button.btn.btn-primary", { type: "button", onClick: () => openPopup("account", ctx, { mode: "signin" }) }, "Sign in"),
        h("button.btn", { type: "button", onClick: () => openPopup("account", ctx, { mode: "create" }) }, "Create account")),
    ];
  } else {
    const signOut = h("button.btn.btn-quiet.btn-sm", { type: "button" }, iconEl("logout"), "Sign out");
    signOut.addEventListener("click", async () => {
      signOut.classList.add("is-loading");
      signOut.disabled = true;
      // Whatever is still waiting to be sent goes first, if the road allows.
      if (ctx.store.status.pending > 0) await Promise.race([ctx.store.sync(), wait(4000)]);
      await ctx.net.signOut();
      if (modal && !modal.closed) modal.close("action");
      toast("Signed out", { kind: "info", icon: "logout" });
    });
    accountBody = h("div.well.account",
      h("span.avatar", { "aria-hidden": "true" }, name.charAt(0).toUpperCase()),
      h("div.grow", h("span.strong", name)),
      signOut);
  }
  const accountNote = h("span.small", { class: guest ? "muted" : "t-good" }, guest ? "Not signed in" : "Signed in");

  /* ---- connection, kept current while the dialog is open ---- */
  const status = h("span.v");
  const lastSync = h("span.v");
  const waiting = h("span.v");
  const connection = h("div.stats",
    stat("Status", status),
    guest ? null : stat("Last sync", lastSync),
    // No "Rules: Edition N": it was the engine's schema number, which says nothing to a player.
    guest ? null : stat("Waiting to send", waiting));

  const paint = () => {
    const [text, tone] = connectionText(ctx);
    setText(status, text);
    for (const t of ["good", "bad", "tan"]) toggleClass(status, `t-${t}`, tone === t);
    toggleClass(status, "muted", tone === "muted");
    if (!guest) {
      const at = ctx.store.status.lastSyncAt;
      setText(lastSync, at ? fmtAgo(ctx.store.now() - at) : "Not yet");
      const n = ctx.store.status.pending;
      setText(waiting, n ? `${fmtWhole(n)} ${n === 1 ? "command" : "commands"}` : "Nothing");
    }
  };
  paint();
  offs.push(ctx.onTick(paint));

  /* ---- starting over ---- */
  const reset = h("button.btn.btn-danger.btn-soft", { type: "button" }, "Start over");
  reset.addEventListener("click", async () => {
    const ok = await confirm({
      title: "Start over?",
      body: guest
        ? "Every skill, item, companion and coin is gone for good. There is no getting it back."
        : "Every skill, item, companion and coin is gone for good, and your open market listings go with them. There is no getting it back.",
      confirmText: "Wipe my camp",
      danger: true,
      typeToConfirm: "RESET",
    });
    if (!ok || !modal || modal.closed) return;
    reset.classList.add("is-loading");
    reset.disabled = true;
    const res = await ctx.dispatch("resetCamp");
    if (!modal.closed) {
      reset.classList.remove("is-loading");
      reset.disabled = false;
    }
    if (!res.ok) return;
    if (!modal.closed) modal.close("action");
    toast("The camp is a ruin again", { kind: "bad", icon: "skull" });
    ctx.go("#/character");
  });

  modal = openModal({
    title: "Settings",
    sub: "Account, connection and starting over",
    art: "gear",
    body: [
      h("section.set-section",
        h("div.set-head", h("h3.set-title", "Account"), accountNote),
        accountBody),
      h("section.set-section",
        h("div.set-head", h("h3.set-title", "Connection")),
        connection),
      h("section.set-section",
        h("div.set-head", h("h3.set-title", "How saving works")),
        h("p.set-copy", guest
          ? "A guest camp lives in this tab and nowhere else. Signed in, the server keeps your camp, and it carries on there while you are away."
          : "The server keeps your camp. What you do here reaches it within a second or two, and the camp carries on there while you are away.")),
      h("section.set-section",
        h("div.danger-zone.vstack.gap-2",
          h("h3.set-title", "Start over"),
          h("p.set-copy", "Wipes this character back to a ruin. Skills, gear, gold and companions are all lost, for good."),
          h("div", reset))),
    ],
    onClose: () => offs.splice(0).forEach((off) => off()),
  });
  return modal;
});

/* ================= 2. SIGN IN AND CREATE ACCOUNT ================= */

const COPY = {
  signin: {
    title: "Sign in",
    sub: "Your camp, kept by the server",
    art: "person",
    verb: "Sign in",
    leave: "Signing in opens your account's camp. Everything in this guest camp stays behind, for good.",
  },
  create: {
    title: "Create an account",
    sub: "A name is yours for good: parties and the Leaderboard know you by it",
    art: "user-plus",
    verb: "Create account",
    leave: "A new account starts from a ruin of its own. Everything in this guest camp stays behind, for good.",
  },
};

registerPopup("account", (ctx, { mode = "signin" } = {}) => {
  let current = mode === "create" ? "create" : "signin";
  let modal;

  const user = h("input.input#acctUser", {
    type: "text", autocomplete: "username", autocapitalize: "none", autocorrect: "off", spellcheck: "false",
    maxlength: "20", enterkeyhint: "next", "aria-describedby": "acctUserHint",
  });
  const pass = h("input.input#acctPass", { type: "password", autocomplete: "current-password", enterkeyhint: "go", "aria-describedby": "acctPassHint" });
  const userHint = h("span.field-hint#acctUserHint");
  const passHint = h("span.field-hint#acctPassHint");
  const formError = h("p.field-hint.t-bad", { role: "alert", hidden: true });

  const tabIn = h("button.seg-btn", { type: "button", role: "tab", onClick: () => switchTo("signin") }, "Sign in");
  const tabCreate = h("button.seg-btn", { type: "button", role: "tab", onClick: () => switchTo("create") }, "Create account");

  const guestLeaving = ctx.account.mode === "guest" && hasProgress(ctx.state);
  const note = !ctx.net || !ctx.net.enabled
    ? h("p.modal-note", "Accounts need the server, and it can't be reached from this page.")
    : guestLeaving
      ? h("p.modal-note", "This guest camp stays behind when you sign in.")
      : null;

  /* Discord, above the fields: it is one press either way, so it does not care which
     tab you are on. The server names a Discord account itself (handler.js's
     accountFor falls back to a p_ name off the user id when the email is not one of
     ours), so there is nothing to fill in here. */
  const discord = ctx.net && ctx.net.enabled && typeof ctx.net.signInWithDiscord === "function"
    ? h("button.btn.btn-oauth", { type: "button" }, iconEl("party"), "Continue with Discord")
    : null;
  if (discord) {
    discord.addEventListener("click", async () => {
      showError(null);
      if (ctx.account.mode === "guest" && hasProgress(ctx.state)) {
        const leave = await confirm({
          title: "Leave this camp behind?",
          body: COPY[current].leave,
          confirmText: "Continue with Discord",
          danger: true,
        });
        if (!leave) return;
      }
      discord.classList.add("is-loading");
      discord.disabled = true;
      // On success the page leaves for Discord, so the button is never let go of.
      const error = await ctx.net.signInWithDiscord();
      if (!error) return;
      discord.classList.remove("is-loading");
      discord.disabled = false;
      showError(error);
    });
  }

  const form = h("form.vstack.gap-3", { novalidate: true },
    h("div.seg.seg-full", { role: "tablist", "aria-label": "Account" }, tabIn, tabCreate),
    note,
    ...(discord ? [discord, h("div.divider-or", h("span", "or with a username"))] : []),
    h("div.set-fields",
      h("div.field", h("label.field-label", { for: "acctUser" }, "Username"), user, userHint),
      h("div.field", h("label.field-label", { for: "acctPass" }, "Password"), pass, passHint)),
    formError);

  function fieldError(input, hint, message, fallback) {
    toggleClass(input, "is-invalid", !!message);
    setAttr(input, "aria-invalid", message ? "true" : null);
    toggleClass(hint, "t-bad", !!message);
    setText(hint, message || fallback || "");
  }

  function hints() {
    const create = current === "create";
    fieldError(user, userHint, null, create ? "3 to 20 letters, numbers or underscores." : "");
    fieldError(pass, passHint, null, create ? "At least 6 characters." : "");
  }

  function showError(message) {
    formError.hidden = !message;
    setText(formError, message || "");
  }

  function switchTo(next) {
    current = next;
    const copy = COPY[current];
    setAttr(tabIn, "aria-selected", String(current === "signin"));
    setAttr(tabCreate, "aria-selected", String(current === "create"));
    setAttr(pass, "autocomplete", current === "create" ? "new-password" : "current-password");
    showError(null);
    hints();
    if (modal) {
      modal.setTitle(copy.title, copy.sub);
      const art = modal.el.querySelector(".modal-head .art");
      if (art) art.replaceChildren(iconEl(copy.art));
      if (modal.buttons[1]) setText(modal.buttons[1].querySelector("span"), copy.verb);
    }
  }

  async function submit() {
    showError(null);
    hints();
    const name = cleanUsername(user.value);
    const password = pass.value;
    const create = current === "create";
    const userBad = create ? usernameError(name) : (name ? null : "Enter your username.");
    const passBad = create ? passwordError(password) : (password ? null : "Enter your password.");
    if (userBad) fieldError(user, userHint, userBad);
    if (passBad) fieldError(pass, passHint, passBad);
    if (userBad || passBad) {
      (userBad ? user : pass).focus();
      return false;
    }

    if (ctx.account.mode === "guest" && hasProgress(ctx.state)) {
      const leave = await confirm({
        title: "Leave this camp behind?",
        body: COPY[current].leave,
        confirmText: COPY[current].verb,
        danger: true,
      });
      if (!leave) return false;
    }

    const error = create ? await ctx.net.signUp(name, password) : await ctx.net.signIn(name, password);
    if (error) {
      showError(error);
      pass.select();
      return false;
    }
    toast(create ? `Welcome to the realm, ${name}` : `Signed in as ${name}`, { kind: "good", icon: "person" });
    return true;
  }

  // Enter goes through the footer button, so it shows that it is busy.
  const press = () => {
    const go = modal && modal.buttons[1];
    if (go && !go.disabled) go.click();
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    press();
  });
  user.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (pass.value) press();
    else pass.focus();
  });
  pass.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    press();
  });
  user.addEventListener("input", () => { fieldError(user, userHint, null, current === "create" ? "3 to 20 letters, numbers or underscores." : ""); showError(null); });
  pass.addEventListener("input", () => { fieldError(pass, passHint, null, current === "create" ? "At least 6 characters." : ""); showError(null); });

  const copy = COPY[current];
  modal = openModal({
    title: copy.title,
    sub: copy.sub,
    art: copy.art,
    size: "sm",
    body: form,
    initialFocus: user,
    footLayout: "row",
    actions: [
      { label: "Cancel", kind: "quiet" },
      { label: copy.verb, kind: "primary", onClick: () => submit() },
    ],
  });
  switchTo(current);
  return modal;
});
