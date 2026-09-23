(() => {
  "use strict";

  const STORAGE_KEY = "stockfamily.sidebar.collapsed";

  const WIDTH_EXPANDED = 240;
  const WIDTH_COLLAPSED = 72;

  const NAV = [
    {
      key: "dashboard",
      label: "Dashboard",
      href: "/",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11.5 12 4l9 7.5"></path>
          <path d="M5.5 10.5V20h13v-9.5"></path>
          <path d="M9 20v-5h6v5"></path>
        </svg>
      `,
    },
    {
      key: "screener",
      label: "Screener",
      href: "/screener.html",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16"></path>
          <path d="M7 10h10"></path>
          <path d="M10 15h4"></path>
          <path d="M12 15v5"></path>
        </svg>
      `,
    },
    {
      key: "backtest",
      label: "Backtest",
      href: "/backtest.html",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5"></path>
          <path d="M4 19h16"></path>
          <path d="m7 15 3-4 3 2 4-6"></path>
        </svg>
      `,
    },
    {
      key: "watchlist",
      label: "Watchlist",
      href: "/watchlist.html",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 8.7l6.2-.9L12 3Z"></path>
        </svg>
      `,
    },
    {
      key: "admin",
      label: "Admin",
      href: "/admin.html",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 13.4 5.7l3 .5 2.2 2.2-.5 3L19.4 14l-1.3 2.7.5 3-2.2 2.1-3 .5L12 21l-2.8 1.3-2.2-2.1.5-3L6.2 14l1.3-2.6-.5-3 2.2-2.2 3-.5L12 3Z"></path>
          <circle cx="12" cy="14" r="3"></circle>
        </svg>
      `,
    },
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
        "stockfamily-global-sidebar-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "stockfamily-global-sidebar-style";

    style.textContent = `

      :root {
        --sf-sidebar-expanded: ${WIDTH_EXPANDED}px;
        --sf-sidebar-collapsed: ${WIDTH_COLLAPSED}px;
        --sf-sidebar-width: ${WIDTH_EXPANDED}px;

        --sf-bg: #080b0d;
        --sf-bg-soft: #0d1113;
        --sf-border: #1a2227;
        --sf-text: #f2f5f6;
        --sf-muted: #7d878e;
        --sf-dim: #4d575d;
        --sf-accent: #00d084;
      }

      /*
       * GLOBAL SHELL
       */
      body.sf-shell {
        padding-left: var(--sf-sidebar-width) !important;
        transition:
          padding-left .32s
          cubic-bezier(.22,.61,.36,1) !important;
      }

      html.sf-sidebar-collapsed
      body.sf-shell {
        --sf-sidebar-width:
          var(--sf-sidebar-collapsed);
      }

      /*
       * Canonical sidebar
       */
      #stockfamily-global-sidebar {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        bottom: 0 !important;

        width:
          var(--sf-sidebar-width) !important;

        min-width:
          var(--sf-sidebar-width) !important;

        height: 100dvh !important;

        z-index: 99999 !important;

        background:
          linear-gradient(
            180deg,
            #0a0e10 0%,
            #070a0c 100%
          ) !important;

        border-right:
          1px solid var(--sf-border) !important;

        box-shadow:
          14px 0 38px
          rgba(0,0,0,.20) !important;

        transition:
          width .32s
          cubic-bezier(.22,.61,.36,1) !important;

        overflow: visible !important;
      }

      .sf-sidebar-inner {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 22px 10px 14px;
      }

      /*
       * Brand
       */
      .sf-sidebar-brand {
        height: 46px;

        display: flex;
        align-items: center;

        gap: 10px;

        padding: 0 8px;

        overflow: hidden;
        white-space: nowrap;
      }

      .sf-brand-mark {
        width: 30px;
        height: 30px;

        flex: 0 0 30px;

        display: grid;
        place-items: center;

        border-radius: 9px;

        background:
          linear-gradient(
            135deg,
            #00d084,
            #00a7ff
          );

        color: #06100c;

        font:
          900 11px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;
      }

      .sf-brand-copy {
        min-width: 0;

        transition:
          opacity .18s ease,
          max-width .28s
          cubic-bezier(.22,.61,.36,1),
          transform .25s ease;

        overflow: hidden;
      }

      .sf-brand-name {
        font:
          800 14px/1
          Inter,
          system-ui,
          sans-serif;

        letter-spacing: -.025em;

        color: var(--sf-text);
      }

      .sf-brand-sub {
        margin-top: 4px;

        font:
          700 7px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        letter-spacing: .18em;

        color: var(--sf-dim);

        text-transform: uppercase;
      }

      /*
       * Section
       */
      .sf-sidebar-section {
        margin:
          30px 9px 10px;

        color: #465158;

        font:
          800 7px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        letter-spacing: .18em;

        text-transform: uppercase;

        white-space: nowrap;

        overflow: hidden;

        transition:
          opacity .18s ease,
          max-width .25s ease;
      }

      /*
       * Navigation
       */
      .sf-sidebar-nav {
        display:
          flex;

        flex-direction:
          column;

        gap: 4px;
      }

      .sf-nav-item {
        position: relative;

        height: 43px;

        display:
          flex;

        align-items:
          center;

        gap: 12px;

        padding:
          0 10px;

        border-radius: 10px;

        border:
          1px solid transparent;

        color:
          #8a959b;

        text-decoration: none;

        overflow: hidden;

        transition:
          background .18s ease,
          color .18s ease,
          border-color .18s ease,
          transform .16s ease;
      }

      .sf-nav-item:hover {
        color:
          #f5f8f9;

        background:
          rgba(255,255,255,.035);

        transform:
          translateX(2px);
      }

      .sf-nav-item.sf-active {
        color:
          #effff8;

        background:
          linear-gradient(
            90deg,
            rgba(0,208,132,.105),
            rgba(0,208,132,.025)
          );

        border-color:
          rgba(0,208,132,.13);
      }

      .sf-nav-item.sf-active::before {
        content: "";

        position: absolute;

        left: 0;
        top: 8px;
        bottom: 8px;

        width: 3px;

        border-radius:
          0 4px 4px 0;

        background:
          var(--sf-accent);

        box-shadow:
          0 0 9px
          rgba(0,208,132,.32);
      }

      .sf-nav-icon {
        width: 19px;
        height: 19px;

        flex:
          0 0 19px;

        display:
          grid;

        place-items:
          center;
      }

      .sf-nav-icon svg {
        width: 18px;
        height: 18px;

        fill: none;

        stroke:
          currentColor;

        stroke-width:
          1.65;

        stroke-linecap:
          round;

        stroke-linejoin:
          round;
      }

      .sf-nav-label {
        font:
          700 12px/1
          Inter,
          system-ui,
          sans-serif;

        white-space:
          nowrap;

        overflow:
          hidden;

        max-width:
          150px;

        opacity:
          1;

        transform:
          translateX(0);

        transition:
          opacity .16s ease,
          max-width .28s
          cubic-bezier(.22,.61,.36,1),
          transform .24s ease;
      }

      /*
       * Bottom metadata
       */
      .sf-sidebar-footer {
        margin-top:
          auto;

        padding:
          13px 9px 4px;

        border-top:
          1px solid #151c20;

        color:
          #424d53;

        font:
          700 7px/1.55
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        letter-spacing:
          .10em;

        text-transform:
          uppercase;

        transition:
          opacity .18s ease,
          max-width .25s ease;
      }

      /*
       * Toggle
       */
      .sf-sidebar-toggle {
        position:
          absolute;

        right:
          -14px;

        top:
          76px;

        width:
          29px;

        height:
          29px;

        display:
          grid;

        place-items:
          center;

        padding:
          0;

        border:
          1px solid #252f34;

        border-radius:
          999px;

        background:
          #0d1214;

        color:
          #b8c1c6;

        cursor:
          pointer;

        box-shadow:
          0 8px 24px
          rgba(0,0,0,.32);

        transition:
          transform .18s ease,
          background .18s ease,
          color .18s ease,
          border-color .18s ease;
      }

      .sf-sidebar-toggle:hover {
        transform:
          scale(1.08);

        background:
          #12191c;

        color:
          #ffffff;

        border-color:
          rgba(0,208,132,.35);
      }

      .sf-sidebar-toggle svg {
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
      .sf-sidebar-toggle svg {
        transform:
          rotate(180deg);
      }

      /*
       * COLLAPSED
       */
      html.sf-sidebar-collapsed
      #stockfamily-global-sidebar {
        width:
          var(--sf-sidebar-collapsed) !important;

        min-width:
          var(--sf-sidebar-collapsed) !important;
      }

      html.sf-sidebar-collapsed
      .sf-brand-copy,
      html.sf-sidebar-collapsed
      .sf-sidebar-section,
      html.sf-sidebar-collapsed
      .sf-nav-label,
      html.sf-sidebar-collapsed
      .sf-sidebar-footer {
        opacity:
          0;

        max-width:
          0;

        transform:
          translateX(-8px);
      }

      html.sf-sidebar-collapsed
      .sf-sidebar-brand {
        justify-content:
          center;

        padding-left:
          0;

        padding-right:
          0;
      }

      html.sf-sidebar-collapsed
      .sf-nav-item {
        justify-content:
          center;

        gap:
          0;

        padding-left:
          0;

        padding-right:
          0;
      }

      /*
       * Tooltip
       */
      html.sf-sidebar-collapsed
      .sf-nav-item[data-tooltip]::after {
        content:
          attr(data-tooltip);

        position:
          absolute;

        left:
          calc(100% + 12px);

        top:
          50%;

        transform:
          translateY(-50%)
          translateX(-5px);

        opacity:
          0;

        pointer-events:
          none;

        white-space:
          nowrap;

        padding:
          7px 9px;

        border:
          1px solid #242d32;

        border-radius:
          7px;

        background:
          #101517;

        color:
          #eef3f5;

        font:
          700 10px/1
          ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;

        box-shadow:
          0 10px 28px
          rgba(0,0,0,.32);

        transition:
          opacity .15s ease,
          transform .15s ease;

        z-index:
          100000;
      }

      html.sf-sidebar-collapsed
      .sf-nav-item[data-tooltip]:hover::after {
        opacity:
          1;

        transform:
          translateY(-50%)
          translateX(0);
      }

      /*
       * Legacy sidebar removal
       */
      .sf-legacy-global-sidebar {
        display:
          none !important;
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

          box-shadow:
            20px 0 48px
            rgba(0,0,0,.42) !important;
        }

        html.sf-sidebar-collapsed
        #stockfamily-global-sidebar {
          transform:
            translateX(-106%);
        }

        html.sf-sidebar-collapsed
        .sf-brand-copy,
        html.sf-sidebar-collapsed
        .sf-sidebar-section,
        html.sf-sidebar-collapsed
        .sf-nav-label,
        html.sf-sidebar-collapsed
        .sf-sidebar-footer {
          opacity:
            1;

          max-width:
            180px;

          transform:
            translateX(0);
        }

        html.sf-sidebar-collapsed
        .sf-sidebar-brand,
        html.sf-sidebar-collapsed
        .sf-nav-item {
          justify-content:
            flex-start;

          gap:
            12px;

          padding-left:
            10px;

          padding-right:
            10px;
        }

        .sf-sidebar-toggle {
          display:
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
            99998;

          border:
            1px solid #263136;

          border-radius:
            12px;

          background:
            rgba(10,14,16,.94);

          color:
            #eef3f5;

          cursor:
            pointer;

          box-shadow:
            0 9px 28px
            rgba(0,0,0,.3);
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

        #sf-mobile-backdrop {
          position:
            fixed;

          inset:
            0;

          display:
            block;

          z-index:
            99990;

          background:
            rgba(0,0,0,.50);

          backdrop-filter:
            blur(2px);

          opacity:
            1;

          pointer-events:
            auto;

          transition:
            opacity .22s ease;
        }

        html.sf-sidebar-collapsed
        #sf-mobile-backdrop {
          opacity:
            0;

          pointer-events:
            none;
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

          animation-iteration-count:
            1 !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function findLegacyGlobalSidebar() {

    const labels =
      NAV.map(
        (x) =>
          x.label.toLowerCase()
      );

    const selectors = [
      "aside",
      "nav",
      '[role="navigation"]',
      '[class*="sidebar" i]',
      '[class*="sidenav" i]',
      '[class*="side-nav" i]',
    ];

    const candidates = [];

    for (
      const selector of selectors
    ) {

      document
        .querySelectorAll(selector)
        .forEach((el) => {

          if (
            el.id ===
            "stockfamily-global-sidebar"
          ) {
            return;
          }

          const rect =
            el.getBoundingClientRect();

          const style =
            getComputedStyle(el);

          const text =
            (
              el.innerText ||
              el.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

          const matches =
            labels.filter(
              (label) =>
                text.includes(label)
            ).length;

          if (
            matches < 3 ||
            rect.width < 150 ||
            rect.width > 380 ||
            rect.height <
              window.innerHeight * .45 ||
            rect.left > 90 ||
            style.display === "none" ||
            style.visibility === "hidden"
          ) {
            return;
          }

          candidates.push({
            el,
            score:
              matches * 10 +
              (rect.left <= 20 ? 10 : 0) +
              (
                style.position === "fixed" ||
                style.position === "sticky"
                  ? 8
                  : 0
              ),
          });
        });
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );

    return candidates.length
      ? candidates[0].el
      : null;
  }

  function removeLegacySidebar() {

    const legacy =
      findLegacyGlobalSidebar();

    if (!legacy) {
      return null;
    }

    legacy.classList.add(
      "sf-legacy-global-sidebar"
    );

    legacy.setAttribute(
      "aria-hidden",
      "true"
    );

    // Remove after hiding so it cannot
    // interfere with layout.
    legacy.remove();

    return legacy;
  }

  function createSidebar() {

    const existing =
      document.getElementById(
        "stockfamily-global-sidebar"
      );

    if (existing) {
      return existing;
    }

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

      <div class="sf-sidebar-inner">

        <div class="sf-sidebar-brand">

          <div class="sf-brand-mark">
            SF
          </div>

          <div class="sf-brand-copy">

            <div class="sf-brand-name">
              StockFamily
            </div>

            <div class="sf-brand-sub">
              IDX INTELLIGENCE
            </div>

          </div>

        </div>

        <div class="sf-sidebar-section">
          Navigation
        </div>

        <nav
          class="sf-sidebar-nav"
          aria-label="StockFamily navigation"
        >

          ${NAV.map(
            (item) => `
              <a
                class="sf-nav-item"
                href="${item.href}"
                data-sf-key="${item.key}"
                data-tooltip="${item.label}"
              >

                <span
                  class="sf-nav-icon"
                  aria-hidden="true"
                >
                  ${item.icon}
                </span>

                <span class="sf-nav-label">
                  ${item.label}
                </span>

              </a>
            `
          ).join("")}

        </nav>

        <div class="sf-sidebar-footer">
          StockFamily<br>
          Canonical Navigation
        </div>

      </div>

      <button
        type="button"
        class="sf-sidebar-toggle"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
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
        ".sf-nav-item"
      )
      .forEach((link) => {

        const active =
          link.dataset.sfKey ===
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

    const button =
      document.querySelector(
        ".sf-sidebar-toggle"
      );

    if (button) {

      button.setAttribute(
        "aria-label",
        collapsed
          ? "Expand sidebar"
          : "Collapse sidebar"
      );

      button.setAttribute(
        "title",
        collapsed
          ? "Expand sidebar"
          : "Collapse sidebar"
      );
    }
  }

  function setupToggle(sidebar) {

    const button =
      sidebar.querySelector(
        ".sf-sidebar-toggle"
      );

    if (!button) {
      return;
    }

    button.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        event.stopPropagation();

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

  function setupKeyboardShortcut() {

    if (
      window.__stockfamilySidebarShortcut
    ) {
      return;
    }

    window.__stockfamilySidebarShortcut =
      true;

    document.addEventListener(
      "keydown",
      (event) => {

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
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

  function setupNavigation() {

    document
      .querySelectorAll(
        "#stockfamily-global-sidebar a[href]"
      )
      .forEach((link) => {

        if (
          link.dataset.sfBound
        ) {
          return;
        }

        link.dataset.sfBound =
          "true";

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

            document.documentElement
              .classList.add(
                "sf-navigating"
              );

            document.body.style.opacity =
              ".78";

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

    if (
      document.getElementById(
        "sf-mobile-backdrop"
      )
    ) {
      return;
    }

    const backdrop =
      document.createElement(
        "div"
      );

    backdrop.id =
      "sf-mobile-backdrop";

    backdrop.addEventListener(
      "click",
      () => {

        if (
          window.innerWidth <= 800
        ) {
          setState(true);
        }
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

    button.type = "button";

    button.setAttribute(
      "aria-label",
      "Open StockFamily navigation"
    );

    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
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

  function adjustFixedSecondaryRail() {

    if (
      window.innerWidth <= 800
    ) {
      return;
    }

    const width =
      document.documentElement
        .classList
        .contains(
          "sf-sidebar-collapsed"
        )
        ? WIDTH_COLLAPSED
        : WIDTH_EXPANDED;

    const candidates =
      [
        ...document.querySelectorAll(
          "body *"
        ),
      ];

    for (
      const el of candidates
    ) {

      if (
        el.id ===
        "stockfamily-global-sidebar"
      ) {
        continue;
      }

      const text =
        (
          el.innerText ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      if (
        !text.startsWith("watchlist")
      ) {
        continue;
      }

      const rect =
        el.getBoundingClientRect();

      const style =
        getComputedStyle(el);

      if (
        (
          style.position === "fixed" ||
          style.position === "sticky"
        ) &&
        rect.width >= 240 &&
        rect.width <= 430 &&
        rect.left <= 8 &&
        rect.height >
          window.innerHeight * .55
      ) {

        el.style.left =
          `${width}px`;

        break;
      }
    }
  }

  function bindResize() {

    let timer = null;

    window.addEventListener(
      "resize",
      () => {

        window.clearTimeout(
          timer
        );

        timer =
          window.setTimeout(
            () => {
              adjustFixedSecondaryRail();
            },
            80
          );
      }
    );
  }

  function init() {

    injectCSS();

    document.body.classList.add(
      "sf-shell"
    );

    // Replace any legacy StockFamily
    // global navigation with canonical nav.
    removeLegacySidebar();

    const sidebar =
      createSidebar();

    markActive(
      sidebar
    );

    setupToggle(
      sidebar
    );

    setupNavigation();

    setupKeyboardShortcut();

    createMobileControls();

    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );

    setState(
      saved === "true"
    );

    adjustFixedSecondaryRail();

    bindResize();
  }

  if (
    document.readyState === "loading"
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