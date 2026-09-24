(() => {
  "use strict";

  const STORAGE_KEY =
    "stockfamily.sidebar.collapsed";

  const EXPANDED = 232;
  const COLLAPSED = 68;

  const NAV = [
    {
      key: "dashboard",
      label: "Dashboard",
      href: "/",
      icon: `
        <svg viewBox="0 0 24 24">
          <path d="M3 11.5 12 4l9 7.5"></path>
          <path d="M5.5 10.5V20h13v-9.5"></path>
          <path d="M9 20v-5h6v5"></path>
        </svg>
      `
    },
    {
      key: "screener",
      label: "Screener",
      href: "/screener.html",
      icon: `
        <svg viewBox="0 0 24 24">
          <path d="M4 5h16"></path>
          <path d="M7 10h10"></path>
          <path d="M10 15h4"></path>
          <path d="M12 15v5"></path>
        </svg>
      `
    },
    {
      key: "backtest",
      label: "Backtest",
      href: "/backtest.html",
      icon: `
        <svg viewBox="0 0 24 24">
          <path d="M4 19V5"></path>
          <path d="M4 19h16"></path>
          <path d="m7 15 3-4 3 2 4-6"></path>
        </svg>
      `
    },
    {
      key: "watchlist",
      label: "Watchlist",
      href: "/watchlist.html",
      icon: `
        <svg viewBox="0 0 24 24">
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 8.7l6.2-.9L12 3Z"></path>
        </svg>
      `
    },
    {
      key: "admin",
      label: "Admin",
      href: "/admin.html",
      icon: `
        <svg viewBox="0 0 24 24">
          <path d="M12 3 13.4 5.7l3 .5 2.2 2.2-.5 3L19.4 14l-1.3 2.7.5 3-2.2 2.1-3 .5L12 21l-2.8 1.3-2.2-2.1.5-3L6.2 14l1.3-2.6-.5-3 2.2-2.2 3-.5L12 3Z"></path>
          <circle cx="12" cy="14" r="3"></circle>
        </svg>
      `
    }
  ];

  function currentPage() {

    const path =
      window.location.pathname
        .replace(/\\/g, "/")
        .toLowerCase();

    if (
      path === "/" ||
      path === "" ||
      path.endsWith("/index.html")
    ) {
      return "dashboard";
    }

    if (path.endsWith("/screener.html")) {
      return "screener";
    }

    if (path.endsWith("/backtest.html")) {
      return "backtest";
    }

    if (path.endsWith("/watchlist.html")) {
      return "watchlist";
    }

    if (path.endsWith("/admin.html")) {
      return "admin";
    }

    return "";
  }

  function injectCSS() {

    if (
      document.getElementById(
        "stockfamily-sidebar-v6"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "stockfamily-sidebar-v6";

    style.textContent = `

      :root {
        --sf-expanded: ${EXPANDED}px;
        --sf-collapsed: ${COLLAPSED}px;
        --sf-width: ${EXPANDED}px;
      }

      body.sf-shell {
        padding-left:
          var(--sf-width) !important;

        transition:
          padding-left .32s
          cubic-bezier(.22,.61,.36,1);
      }

      html.sf-sidebar-collapsed {
        --sf-width:
          var(--sf-collapsed);
      }

      #stockfamily-global-sidebar {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        bottom: 0 !important;

        width:
          var(--sf-width) !important;

        min-width:
          var(--sf-width) !important;

        height: 100dvh !important;

        z-index: 999999 !important;

        background:
          linear-gradient(
            180deg,
            #0a0e10 0%,
            #070a0c 100%
          ) !important;

        border-right:
          1px solid #182024 !important;

        box-shadow:
          12px 0 34px
          rgba(0,0,0,.20) !important;

        transition:
          width .32s
          cubic-bezier(.22,.61,.36,1) !important;

        overflow:
          visible !important;
      }

      .sf-inner {
        height: 100%;

        display:
          flex;

        flex-direction:
          column;

        padding:
          18px 9px 12px;
      }

      .sf-brand {
        height: 42px;

        display:
          flex;

        align-items:
          center;

        gap:
          9px;

        padding:
          0 7px;

        overflow:
          hidden;
      }

      .sf-mark {
        width:
          29px;

        height:
          29px;

        flex:
          0 0 29px;

        display:
          grid;

        place-items:
          center;

        border-radius:
          8px;

        background:
          linear-gradient(
            135deg,
            #00d084,
            #00a8ff
          );

        color:
          #06100c;

        font:
          900 10px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;
      }

      .sf-brand-copy {
        min-width:
          0;

        max-width:
          160px;

        overflow:
          hidden;

        white-space:
          nowrap;

        transition:
          opacity .17s ease,
          max-width .28s ease,
          transform .25s ease;
      }

      .sf-brand-name {
        font:
          800 13px/1
          Inter,
          system-ui,
          sans-serif;

        color:
          #f3f6f7;

        letter-spacing:
          -.025em;
      }

      .sf-brand-sub {
        margin-top:
          4px;

        color:
          #556168;

        font:
          700 6.5px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        letter-spacing:
          .17em;

        text-transform:
          uppercase;
      }

      .sf-section {
        margin:
          27px 8px 9px;

        color:
          #4b565d;

        font:
          800 6.5px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        letter-spacing:
          .19em;

        text-transform:
          uppercase;

        transition:
          opacity .16s ease,
          max-width .24s ease;

        white-space:
          nowrap;

        overflow:
          hidden;
      }

      .sf-nav {
        display:
          flex;

        flex-direction:
          column;

        gap:
          3px;
      }

      .sf-nav-link {
        position:
          relative;

        height:
          41px;

        display:
          flex;

        align-items:
          center;

        gap:
          11px;

        padding:
          0 9px;

        border:
          1px solid transparent;

        border-radius:
          9px;

        color:
          #8a959b;

        text-decoration:
          none;

        overflow:
          hidden;

        transition:
          background .17s ease,
          border-color .17s ease,
          color .17s ease,
          transform .16s ease;
      }

      .sf-nav-link:hover {
        color:
          #f3f6f7;

        background:
          rgba(255,255,255,.035);

        transform:
          translateX(2px);
      }

      .sf-nav-link.sf-active {
        color:
          #eafff7;

        background:
          linear-gradient(
            90deg,
            rgba(0,208,132,.115),
            rgba(0,208,132,.025)
          );

        border-color:
          rgba(0,208,132,.13);
      }

      .sf-nav-link.sf-active::before {
        content:
          "";

        position:
          absolute;

        left:
          0;

        top:
          8px;

        bottom:
          8px;

        width:
          2px;

        border-radius:
          0 4px 4px 0;

        background:
          #00d084;

        box-shadow:
          0 0 8px
          rgba(0,208,132,.32);
      }

      .sf-icon {
        width:
          18px;

        height:
          18px;

        flex:
          0 0 18px;

        display:
          grid;

        place-items:
          center;
      }

      .sf-icon svg {
        width:
          17px;

        height:
          17px;

        fill:
          none;

        stroke:
          currentColor;

        stroke-width:
          1.7;

        stroke-linecap:
          round;

        stroke-linejoin:
          round;
      }

      .sf-label {
        max-width:
          150px;

        opacity:
          1;

        overflow:
          hidden;

        white-space:
          nowrap;

        font:
          700 11.5px/1
          Inter,
          system-ui,
          sans-serif;

        transition:
          opacity .16s ease,
          max-width .28s ease,
          transform .24s ease;
      }

      .sf-footer {
        margin-top:
          auto;

        padding:
          11px 8px 3px;

        border-top:
          1px solid #151c20;

        color:
          #424d53;

        font:
          700 6.5px/1.5
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        letter-spacing:
          .10em;

        text-transform:
          uppercase;

        transition:
          opacity .16s ease,
          max-width .24s ease;
      }

      .sf-toggle {
        position:
          absolute;

        right:
          -14px;

        top:
          70px;

        width:
          28px;

        height:
          28px;

        display:
          grid;

        place-items:
          center;

        padding:
          0;

        border:
          1px solid #273137;

        border-radius:
          999px;

        background:
          #0d1214;

        color:
          #b8c2c7;

        cursor:
          pointer;

        box-shadow:
          0 8px 22px
          rgba(0,0,0,.32);

        transition:
          transform .18s ease,
          background .18s ease,
          border-color .18s ease;
      }

      .sf-toggle:hover {
        transform:
          scale(1.07);

        background:
          #131a1d;

        border-color:
          rgba(0,208,132,.32);

        color:
          #fff;
      }

      .sf-toggle svg {
        width:
          14px;

        height:
          14px;

        fill:
          none;

        stroke:
          currentColor;

        stroke-width:
          1.9;

        stroke-linecap:
          round;

        stroke-linejoin:
          round;

        transition:
          transform .28s
          cubic-bezier(.22,.61,.36,1);
      }

      html.sf-sidebar-collapsed
      .sf-toggle svg {
        transform:
          rotate(180deg);
      }

      html.sf-sidebar-collapsed
      .sf-brand-copy,
      html.sf-sidebar-collapsed
      .sf-section,
      html.sf-sidebar-collapsed
      .sf-label,
      html.sf-sidebar-collapsed
      .sf-footer {
        opacity:
          0;

        max-width:
          0;

        transform:
          translateX(-7px);
      }

      html.sf-sidebar-collapsed
      .sf-brand {
        justify-content:
          center;

        padding-left:
          0;

        padding-right:
          0;
      }

      html.sf-sidebar-collapsed
      .sf-nav-link {
        justify-content:
          center;

        gap:
          0;

        padding-left:
          0;

        padding-right:
          0;
      }

      html.sf-sidebar-collapsed
      .sf-nav-link[data-tooltip]::after {
        content:
          attr(data-tooltip);

        position:
          absolute;

        left:
          calc(100% + 11px);

        top:
          50%;

        transform:
          translateY(-50%)
          translateX(-4px);

        opacity:
          0;

        pointer-events:
          none;

        padding:
          7px 9px;

        white-space:
          nowrap;

        color:
          #edf3f5;

        background:
          #101517;

        border:
          1px solid #252f34;

        border-radius:
          7px;

        font:
          700 10px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        box-shadow:
          0 10px 28px
          rgba(0,0,0,.34);

        transition:
          opacity .15s ease,
          transform .15s ease;

        z-index:
          1000000;
      }

      html.sf-sidebar-collapsed
      .sf-nav-link[data-tooltip]:hover::after {
        opacity:
          1;

        transform:
          translateY(-50%)
          translateX(0);
      }

      /*
       * Secondary Dashboard rail
       */
      body.sf-shell .sf-secondary-watchlist {
        left:
          var(--sf-width) !important;
      }

      /*
       * Mobile
       */
      #sf-mobile-button,
      #sf-mobile-backdrop {
        display:
          none;
      }

      @media (max-width: 800px) {

        body.sf-shell {
          padding-left:
            0 !important;
        }

        #stockfamily-global-sidebar {
          width:
            min(84vw, 286px) !important;

          min-width:
            min(84vw, 286px) !important;

          transform:
            translateX(0);
        }

        html.sf-sidebar-collapsed
        #stockfamily-global-sidebar {
          transform:
            translateX(-106%);
        }

        html.sf-sidebar-collapsed
        .sf-brand-copy,
        html.sf-sidebar-collapsed
        .sf-section,
        html.sf-sidebar-collapsed
        .sf-label,
        html.sf-sidebar-collapsed
        .sf-footer {
          opacity:
            1;

          max-width:
            180px;

          transform:
            translateX(0);
        }

        html.sf-sidebar-collapsed
        .sf-brand {
          justify-content:
            flex-start;

          padding:
            0 7px;
        }

        html.sf-sidebar-collapsed
        .sf-nav-link {
          justify-content:
            flex-start;

          gap:
            11px;

          padding:
            0 9px;
        }

        #sf-mobile-backdrop {
          position:
            fixed;

          inset:
            0;

          display:
            block;

          z-index:
            999990;

          background:
            rgba(0,0,0,.50);

          backdrop-filter:
            blur(2px);

          opacity:
            1;

          pointer-events:
            auto;

          transition:
            opacity .2s ease;
        }

        html.sf-sidebar-collapsed
        #sf-mobile-backdrop {
          opacity:
            0;

          pointer-events:
            none;
        }

        #sf-mobile-button {
          position:
            fixed;

          left:
            12px;

          top:
            12px;

          width:
            42px;

          height:
            42px;

          display:
            grid;

          place-items:
            center;

          z-index:
            999980;

          border:
            1px solid #273137;

          border-radius:
            12px;

          background:
            rgba(10,14,16,.94);

          color:
            #edf3f5;

          cursor:
            pointer;

          box-shadow:
            0 9px 28px
            rgba(0,0,0,.32);
        }

        #sf-mobile-button svg {
          width:
            19px;

          height:
            19px;

          fill:
            none;

          stroke:
            currentColor;

          stroke-width:
            1.8;

          stroke-linecap:
            round;
        }
      }

      @media (prefers-reduced-motion: reduce) {

        *,
        *::before,
        *::after {
          transition-duration:
            .01ms !important;

          animation-duration:
            .01ms !important;
        }
      }

    `;

    document.head.appendChild(style);
  }

  function detectLegacyNavigation() {

    const all =
      [
        ...document.querySelectorAll(
          "aside, nav, [role='navigation'], [class*='sidebar' i]"
        )
      ];

    const targets = [];

    for (const el of all) {

      if (
        el.id ===
        "stockfamily-global-sidebar"
      ) {
        continue;
      }

      const links =
        [
          ...el.querySelectorAll(
            "a[href]"
          )
        ];

      if (
        links.length < 3
      ) {
        continue;
      }

      const hrefText =
        links
          .map(
            (a) =>
              (
                a.getAttribute("href") ||
                ""
              ).toLowerCase()
          )
          .join(" ");

      const text =
        (
          el.innerText ||
          el.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .toLowerCase();

      const navMatches =
        [
          hrefText.includes(
            "screener"
          ),
          hrefText.includes(
            "backtest"
          ),
          hrefText.includes(
            "watchlist"
          ),
          hrefText.includes(
            "admin"
          ),
          text.includes(
            "dashboard"
          )
        ].filter(Boolean).length;

      const rect =
        el.getBoundingClientRect();

      const looksGlobal =
        navMatches >= 3 &&
        rect.left <= 20 &&
        rect.width >= 180 &&
        rect.width <= 380 &&
        rect.height >
          window.innerHeight * .45;

      if (looksGlobal) {
        targets.push(el);
      }
    }

    return targets;
  }

  function removeLegacyNavigation() {

    for (
      const el of detectLegacyNavigation()
    ) {

      el.style.setProperty(
        "display",
        "none",
        "important"
      );

      el.setAttribute(
        "aria-hidden",
        "true"
      );
    }
  }

  function createSidebar() {

    const sidebar =
      document.createElement(
        "aside"
      );

    sidebar.id =
      "stockfamily-global-sidebar";

    sidebar.setAttribute(
      "aria-label",
      "StockFamily global navigation"
    );

    sidebar.innerHTML = `

      <div class="sf-inner">

        <div class="sf-brand">

          <div class="sf-mark">
            SF
          </div>

          <div class="sf-brand-copy">

            <div class="sf-brand-name">
              StockFamily
            </div>

            <div class="sf-brand-sub">
              IDX Intelligence
            </div>

          </div>

        </div>

        <div class="sf-section">
          Navigation
        </div>

        <nav
          class="sf-nav"
          aria-label="StockFamily navigation"
        >

          ${NAV.map(
            (item) => `
              <a
                href="${item.href}"
                class="sf-nav-link"
                data-key="${item.key}"
                data-tooltip="${item.label}"
              >

                <span
                  class="sf-icon"
                  aria-hidden="true"
                >
                  ${item.icon}
                </span>

                <span class="sf-label">
                  ${item.label}
                </span>

              </a>
            `
          ).join("")}

        </nav>

        <div class="sf-footer">
          StockFamily<br>
          Canonical Navigation
        </div>

      </div>

      <button
        type="button"
        class="sf-toggle"
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
      >
        <svg viewBox="0 0 24 24">
          <path d="m14 6-6 6 6 6"></path>
        </svg>
      </button>
    `;

    document.body.prepend(
      sidebar
    );

    return sidebar;
  }

  function markActive(sidebar) {

    const current =
      currentPage();

    sidebar
      .querySelectorAll(
        ".sf-nav-link"
      )
      .forEach((link) => {

        const active =
          link.dataset.key ===
          current;

        link.classList.toggle(
          "sf-active",
          active
        );

        if (active) {

          link.setAttribute(
            "aria-current",
            "page"
          );

        } else {

          link.removeAttribute(
            "aria-current"
          );
        }
      });
  }

  function setState(collapsed) {

    document.documentElement
      .classList.toggle(
        "sf-sidebar-collapsed",
        collapsed
      );

    localStorage.setItem(
      STORAGE_KEY,
      String(collapsed)
    );

    const toggle =
      document.querySelector(
        ".sf-toggle"
      );

    if (!toggle) {
      return;
    }

    toggle.setAttribute(
      "aria-label",
      collapsed
        ? "Expand sidebar"
        : "Collapse sidebar"
    );

    toggle.setAttribute(
      "title",
      collapsed
        ? "Expand sidebar"
        : "Collapse sidebar"
    );

    adjustDashboardRail();
  }

  function setupToggle(sidebar) {

    const toggle =
      sidebar.querySelector(
        ".sf-toggle"
      );

    if (!toggle) {
      return;
    }

    toggle.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        const collapsed =
          document.documentElement
            .classList
            .contains(
              "sf-sidebar-collapsed"
            );

        setState(
          !collapsed
        );
      }
    );
  }

  function setupNavigation() {

    document
      .querySelectorAll(
        "#stockfamily-global-sidebar a[href]"
      )
      .forEach((link) => {

        link.addEventListener(
          "click",
          (event) => {

            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }

            const href =
              link.getAttribute(
                "href"
              );

            if (!href) {
              return;
            }

            let next;

            try {

              next =
                new URL(
                  href,
                  window.location.href
                );

            } catch {

              return;
            }

            if (
              next.origin !==
              window.location.origin
            ) {
              return;
            }

            if (
              next.pathname ===
              window.location.pathname &&
              next.search ===
              window.location.search
            ) {
              return;
            }

            event.preventDefault();

            document.body.style.opacity =
              ".82";

            document.body.style.transition =
              "opacity .12s ease";

            window.setTimeout(
              () => {
                window.location.href =
                  next.href;
              },
              70
            );
          }
        );
      });
  }

  function createMobileControls() {

    const backdrop =
      document.createElement(
        "div"
      );

    backdrop.id =
      "sf-mobile-backdrop";

    backdrop.addEventListener(
      "click",
      () => {
        setState(true);
      }
    );

    document.body.appendChild(
      backdrop
    );

    const button =
      document.createElement(
        "button"
      );

    button.id =
      "sf-mobile-button";

    button.type =
      "button";

    button.setAttribute(
      "aria-label",
      "Open StockFamily navigation"
    );

    button.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M4 7h16"></path>
        <path d="M4 12h16"></path>
        <path d="M4 17h16"></path>
      </svg>
    `;

    button.addEventListener(
      "click",
      () => {
        setState(false);
      }
    );

    document.body.appendChild(
      button
    );
  }

  function adjustDashboardRail() {

    const rail =
      [
        ...document.querySelectorAll(
          "aside, section, div"
        )
      ]
      .find((el) => {

        if (
          el.id ===
          "stockfamily-global-sidebar"
        ) {
          return false;
        }

        const text =
          (
            el.innerText ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();

        const rect =
          el.getBoundingClientRect();

        const style =
          getComputedStyle(el);

        return (
          text.startsWith(
            "WATCHLIST"
          ) &&
          rect.width >= 240 &&
          rect.width <= 380 &&
          rect.height >
            window.innerHeight * .50 &&
          rect.left <= 20 &&
          (
            style.position === "fixed" ||
            style.position === "sticky"
          )
        );
      });

    if (!rail) {
      return;
    }

    rail.classList.add(
      "sf-secondary-watchlist"
    );
  }

  function setupShortcut() {

    document.addEventListener(
      "keydown",
      (event) => {

        if (
          (event.ctrlKey ||
           event.metaKey) &&
          event.key.toLowerCase() === "b"
        ) {

          event.preventDefault();

          const collapsed =
            document.documentElement
              .classList
              .contains(
                "sf-sidebar-collapsed"
              );

          setState(
            !collapsed
          );
        }
      }
    );
  }

  function init() {

    injectCSS();

    document.body.classList.add(
      "sf-shell"
    );

    removeLegacyNavigation();

    const sidebar =
      createSidebar();

    markActive(
      sidebar
    );

    setupToggle(
      sidebar
    );

    setupNavigation();

    createMobileControls();

    setupShortcut();

    adjustDashboardRail();

    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );

    setState(
      saved === "true"
    );

    window.addEventListener(
      "resize",
      adjustDashboardRail
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );

  } else {

    init();
  }

})();