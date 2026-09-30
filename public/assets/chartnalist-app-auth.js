(() => {
  "use strict";

  const LOGIN_PATH = "/login";
  const APP_PATH = "/app";
  const AUTH_ME_URL = "/api/auth/me";

  let supabaseClient = null;
  let authResolved = false;
  let currentProfile = null;

  function installAuthStyles() {
    if (document.getElementById("chartnalist-auth-style")) return;

    const style = document.createElement("style");
    style.id = "chartnalist-auth-style";

    style.textContent = `
      html.chartnalist-auth-pending body {
        visibility: hidden !important;
      }

      #chartnalist-user-menu {
        position: fixed;
        top: 14px;
        right: 18px;
        z-index: 99999;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #chartnalist-user-trigger {
        display: flex;
        align-items: center;
        gap: 9px;
        height: 38px;
        padding: 0 12px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 10px;
        background: rgba(16,19,21,.94);
        color: #f5f7f8;
        cursor: pointer;
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 30px rgba(0,0,0,.25);
      }

      #chartnalist-user-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: #00d084;
        color: #050607;
        font-size: 11px;
        font-weight: 800;
      }

      #chartnalist-user-email {
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
      }

      #chartnalist-user-chevron {
        font-size: 10px;
        opacity: .55;
      }

      #chartnalist-user-dropdown {
        position: absolute;
        top: 46px;
        right: 0;
        width: 230px;
        padding: 8px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        background: #101315;
        box-shadow: 0 18px 50px rgba(0,0,0,.40);
        display: none;
      }

      #chartnalist-user-dropdown.open {
        display: block;
      }

      .chartnalist-user-meta {
        padding: 10px;
        margin-bottom: 5px;
        border-bottom: 1px solid rgba(255,255,255,.07);
      }

      .chartnalist-user-meta-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: .08em;
        color: #626b72;
        margin-bottom: 4px;
      }

      .chartnalist-user-meta-email {
        font-size: 12px;
        color: #f5f7f8;
        word-break: break-all;
      }

      .chartnalist-role-plan {
        display: flex;
        gap: 6px;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      .chartnalist-role-badge,
      .chartnalist-plan-badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 7px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .05em;
      }

      .chartnalist-role-badge {
        background: rgba(0,208,132,.10);
        color: #00d084;
      }

      .chartnalist-plan-badge {
        background: rgba(255,255,255,.06);
        color: #9aa3aa;
      }

      #chartnalist-admin-link {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin: 4px 0;
        padding: 9px 10px;
        border-radius: 8px;
        color: #f5f7f8;
        text-decoration: none;
        font-size: 12px;
      }

      #chartnalist-admin-link:hover {
        background: rgba(255,255,255,.06);
      }

      #chartnalist-logout {
        width: 100%;
        border: 0;
        border-radius: 8px;
        padding: 10px;
        background: transparent;
        color: #ff6b6b;
        text-align: left;
        cursor: pointer;
        font-size: 12px;
      }

      #chartnalist-logout:hover {
        background: rgba(255,77,77,.08);
      }

      #chartnalist-auth-error {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: grid;
        place-items: center;
        background: #050607;
        color: #f5f7f8;
        font-family: Inter, system-ui, sans-serif;
      }

      #chartnalist-auth-error-card {
        width: min(420px, calc(100vw - 40px));
        padding: 28px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 14px;
        background: #101315;
      }

      #chartnalist-auth-error-card strong {
        display: block;
        margin-bottom: 8px;
      }

      #chartnalist-auth-error-card span {
        color: #9aa3aa;
        font-size: 13px;
      }
    `;

    document.head.appendChild(style);
  }

  function getInitials(email) {
    if (!email) return "U";

    const clean = email.trim().toUpperCase();

    if (clean.length >= 2) {
      return clean.slice(0, 2);
    }

    return clean || "U";
  }

  function removeAuthMenu() {
    const existing = document.getElementById("chartnalist-user-menu");
    if (existing) existing.remove();
  }

  async function loadProfile(session) {
    if (!session?.access_token) {
      throw new Error("Authentication session token is missing.");
    }

    const response = await fetch(AUTH_ME_URL, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      throw new Error("Invalid response from authentication service.");
    }

    if (!response.ok || !payload?.success || !payload?.user) {
      throw new Error(
        payload?.error ||
        "Unable to load your Chartnalist profile."
      );
    }

    return payload.user;
  }

  function renderUserMenu(user, profile) {
    removeAuthMenu();

    const email = profile?.email || user?.email || "User";
    const role = profile?.role || "user";
    const plan = profile?.plan || "free";
    const isAdmin = role === "admin";

    const wrapper = document.createElement("div");
    wrapper.id = "chartnalist-user-menu";

    wrapper.innerHTML = `
      <button
        id="chartnalist-user-trigger"
        type="button"
        aria-expanded="false"
        aria-label="Open user menu"
      >
        <span id="chartnalist-user-avatar">${getInitials(email)}</span>
        <span id="chartnalist-user-email"></span>
        <span id="chartnalist-user-chevron">▼</span>
      </button>

      <div id="chartnalist-user-dropdown">
        <div class="chartnalist-user-meta">
          <div class="chartnalist-user-meta-label">Signed in as</div>
          <div class="chartnalist-user-meta-email"></div>

          <div class="chartnalist-role-plan">
            <span class="chartnalist-role-badge"></span>
            <span class="chartnalist-plan-badge"></span>
          </div>
        </div>

        ${
          isAdmin
            ? `
              <a id="chartnalist-admin-link" href="/admin.html">
                Admin
              </a>
            `
            : ""
        }

        <button id="chartnalist-logout" type="button">
          Sign out
        </button>
      </div>
    `;

    document.body.appendChild(wrapper);

    wrapper.querySelector("#chartnalist-user-email").textContent = email;
    wrapper.querySelector(".chartnalist-user-meta-email").textContent = email;
    wrapper.querySelector(".chartnalist-role-badge").textContent = role;
    wrapper.querySelector(".chartnalist-plan-badge").textContent = `Plan: ${plan}`;

    const trigger = wrapper.querySelector("#chartnalist-user-trigger");
    const dropdown = wrapper.querySelector("#chartnalist-user-dropdown");
    const logout = wrapper.querySelector("#chartnalist-logout");

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();

      const open = dropdown.classList.toggle("open");
      trigger.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("click", () => {
      dropdown.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    });

    logout.addEventListener("click", async () => {
      logout.disabled = true;
      logout.textContent = "Signing out...";

      const { error } = await supabaseClient.auth.signOut();

      if (error) {
        console.error("[Chartnalist Auth] Sign out failed:", error);
        logout.disabled = false;
        logout.textContent = "Sign out";
        return;
      }

      window.location.replace(LOGIN_PATH);
    });
  }

  function showAuthError(message) {
    document.documentElement.classList.remove("chartnalist-auth-pending");

    const existing = document.getElementById("chartnalist-auth-error");
    if (existing) return;

    const overlay = document.createElement("div");
    overlay.id = "chartnalist-auth-error";

    overlay.innerHTML = `
      <div id="chartnalist-auth-error-card">
        <strong>Chartnalist authentication error</strong>
        <span></span>
      </div>
    `;

    overlay.querySelector("span").textContent = message;

    document.body.appendChild(overlay);
  }

  async function boot() {
    document.documentElement.classList.add("chartnalist-auth-pending");
    installAuthStyles();

    try {
      const configResponse = await fetch("/api/auth/config", {
        cache: "no-store"
      });

      if (!configResponse.ok) {
        throw new Error("Unable to load authentication configuration.");
      }

      const config = await configResponse.json();

      if (!config.success || !config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error("Supabase authentication configuration is incomplete.");
      }

      if (!window.supabase?.createClient) {
        throw new Error("Supabase client is not available.");
      }

      supabaseClient = window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey
      );

  window.chartnalistSupabase = supabaseClient;

      const {
        data: { session },
        error
      } = await supabaseClient.auth.getSession();

      if (error) {
        throw error;
      }

      if (!session?.user) {
        window.location.replace(LOGIN_PATH);
        return;
      }

      currentProfile = await loadProfile(session);

      window.chartnalistAuth = {
        user: session.user,
        profile: currentProfile,
        role: currentProfile.role || "user",
        plan: currentProfile.plan || "free",
        isAdmin: currentProfile.role === "admin",
        isUser: currentProfile.role === "user",
        signOut: async () => {
          return supabaseClient.auth.signOut();
        }
      };

      renderUserMenu(session.user, currentProfile);

      window.dispatchEvent(
        new CustomEvent("chartnalist:auth-ready", {
          detail: {
            role: currentProfile.role || "user",
            plan: currentProfile.plan || "free",
            isAdmin: currentProfile.role === "admin"
          }
        })
      );

      authResolved = true;
      document.documentElement.classList.remove("chartnalist-auth-pending");

      supabaseClient.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT" || !newSession?.user) {
          window.location.replace(LOGIN_PATH);
        }
      });

    } catch (error) {
      console.error("[Chartnalist Auth]", error);

      if (!authResolved) {
        showAuthError(
          error?.message ||
          "Unable to verify your Chartnalist session."
        );
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();


