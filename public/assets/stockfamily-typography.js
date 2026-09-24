(() => {
  "use strict";

  function findSmallestTextNode(
    target
  ) {

    const candidates = [];

    for (
      const el of document.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,div,span,p,button"
      )
    ) {

      const text =
        (
          el.innerText ||
          el.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !text ||
        text.length > 80 ||
        !text.toUpperCase().includes(
          target
        )
      ) {
        continue;
      }

      const rect =
        el.getBoundingClientRect();

      if (
        rect.width < 40 ||
        rect.width > 430 ||
        rect.height < 8 ||
        rect.height > 100
      ) {
        continue;
      }

      candidates.push({
        el,
        area:
          rect.width *
          rect.height
      });
    }

    candidates.sort(
      (a,b) =>
        a.area - b.area
    );

    return candidates.length
      ? candidates[0].el
      : null;
  }

  function markIntelligencePanel() {

    const targets = [
      "MARKET STRUCTURE",
      "BANDARMOLOGY",
      "GEM SCORE",
      "BID / OFFER",
      "52-WEEK RANGE"
    ];

    let panelCount = 0;

    for (
      const target of targets
    ) {

      const title =
        findSmallestTextNode(
          target
        );

      if (!title) {
        continue;
      }

      title.classList.add(
        "sf-intel-heading"
      );

      /*
       * Find a reasonable parent panel.
       */
      let parent =
        title.parentElement;

      for (
        let depth = 0;
        parent &&
        depth < 5;
        depth++
      ) {

        const rect =
          parent.getBoundingClientRect();

        if (
          rect.width >= 240 &&
          rect.width <= 430 &&
          rect.height >= 80
        ) {

          parent.classList.add(
            "sf-intelligence-panel"
          );

          break;
        }

        parent =
          parent.parentElement;
      }

      panelCount++;
    }

    return panelCount;
  }

  function markMetadata() {

    for (
      const el of document.querySelectorAll(
        "div,span,p"
      )
    ) {

      const text =
        (
          el.innerText ||
          el.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !text ||
        text.length > 45
      ) {
        continue;
      }

      const isDate =
        /\b20\d{2}-\d{2}-\d{2}\b/.test(
          text
        );

      const isSource =
        /\(Heuristik\)|\(Yahoo\)|Yahoo,\s*delayed/i.test(
          text
        );

      if (
        isDate ||
        isSource
      ) {

        const rect =
          el.getBoundingClientRect();

        if (
          rect.width >= 35 &&
          rect.width <= 280 &&
          rect.height <= 40
        ) {

          el.classList.add(
            "sf-intel-meta"
          );

          el.classList.add(
            "sf-date-meta"
          );
        }
      }
    }
  }

  function markDescriptions() {

    const patterns = [
      "Satu-satunya panel",
      "Yahoo sering tidak punya data",
      "data EOD Supabase"
    ];

    for (
      const el of document.querySelectorAll(
        "p,div,span"
      )
    ) {

      const text =
        (
          el.innerText ||
          el.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        text.length < 45 ||
        text.length > 320
      ) {
        continue;
      }

      if (
        patterns.some(
          (pattern) =>
            text
              .toLowerCase()
              .includes(
                pattern.toLowerCase()
              )
        )
      ) {

        el.classList.add(
          "sf-intel-description"
        );
      }
    }
  }

  function markNumericValues() {

    const numberPattern =
      /^(?:Rp\s*)?[+-]?\d[\d.,]*(?:%|\/100|[KMB])?$/;

    for (
      const el of document.querySelectorAll(
        "div,span"
      )
    ) {

      const text =
        (
          el.innerText ||
          el.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !text ||
        text.length > 28
      ) {
        continue;
      }

      if (
        numberPattern.test(
          text
        )
      ) {

        const rect =
          el.getBoundingClientRect();

        if (
          rect.width >= 20 &&
          rect.width <= 260 &&
          rect.height <= 40
        ) {

          el.classList.add(
            "sf-tabular"
          );
        }
      }
    }
  }

  function init() {

    markIntelligencePanel();

    markMetadata();

    markDescriptions();

    markNumericValues();

    document.documentElement
      .classList.add(
        "sf-typography-ready"
      );
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
