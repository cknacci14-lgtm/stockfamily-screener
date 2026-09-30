(function () {
  let supabaseClient = null;
  let configPromise = null;

  function message(text, type) {
    const el = document.getElementById("authMessage");
    if (!el) return;

    el.hidden = false;
    el.textContent = text;
    el.className = "sf-message" + (type ? " " + type : "");
  }

  async function getConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/auth/config", {
        method: "GET",
        cache: "no-store"
      }).then(async (response) => {
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || "Supabase Auth configuration unavailable."
          );
        }

        return data;
      });
    }

    return configPromise;
  }

  async function getClient() {
    if (supabaseClient) return supabaseClient;

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase client gagal dimuat.");
    }

    const config = await getConfig();

    supabaseClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    return supabaseClient;
  }

  async function login(event) {
    event.preventDefault();

    try {
      const client = await getClient();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      message("Signing in...");

      const { error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      window.location.href = "/app";
    } catch (error) {
      message(error.message || "Login gagal.", "error");
    }
  }

  async function register(event) {
    event.preventDefault();

    try {
      const client = await getClient();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const confirm = document.getElementById("passwordConfirm").value;

      if (password.length < 8) {
        throw new Error("Password minimal 8 karakter.");
      }

      if (password !== confirm) {
        throw new Error("Password confirmation tidak sama.");
      }

      message("Creating account...");

      const { data, error } = await client.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      if (data.session) {
        window.location.href = "/app";
        return;
      }

      message(
        "Account berhasil dibuat. Silakan cek email untuk konfirmasi.",
        "success"
      );
    } catch (error) {
      message(error.message || "Registrasi gagal.", "error");
    }
  }

  async function forgotPassword(event) {
    event.preventDefault();

    try {
      const client = await getClient();
      const email = document.getElementById("email").value.trim();

      message("Sending reset link...");

      const redirectTo =
        window.location.origin + "/forgot-password";

      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo
      });

      if (error) throw error;

      message(
        "Jika email terdaftar, link reset password akan dikirim.",
        "success"
      );
    } catch (error) {
      message(error.message || "Reset password gagal.", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const forgotForm = document.getElementById("forgotPasswordForm");

    if (loginForm) loginForm.addEventListener("submit", login);
    if (registerForm) registerForm.addEventListener("submit", register);
    if (forgotForm) forgotForm.addEventListener("submit", forgotPassword);
  });
})();
