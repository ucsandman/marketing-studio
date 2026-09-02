import type { AxeResults } from "axe-core";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardData } from "../app/lib/data";
import { DashboardShell } from "../app/ui/dashboard-shell";
import { SurfaceState } from "../app/ui/surface-state";

declare module "vitest" {
  interface Assertion {
    toHaveNoViolations(): void;
  }
}

expect.extend({
  toHaveNoViolations(results: AxeResults) {
    const violations = results.violations.map((violation) => violation.id).join(", ");
    return {
      message: () => `expected no axe violations, got: ${violations}`,
      pass: results.violations.length === 0,
    };
  },
});

describe("dashboard a11y", () => {
  it("has no axe violations for empty, populated, and error dashboard surfaces", async () => {
    const html = [
      renderDashboard(populatedData()),
      renderSurface("empty"),
      renderSurface("loading"),
      renderSurface("error"),
    ]
      .map(
        (surface, index) =>
          `<section aria-label="Dashboard state ${index + 1}">${surface}</section>`,
      )
      .join("");

    expect(await axeHtml(html)).toHaveNoViolations();
  });
});

function renderDashboard(data: DashboardData) {
  return renderToStaticMarkup(createElement(DashboardShell, { data }));
}

function renderSurface(state: "empty" | "error" | "loading") {
  return renderToStaticMarkup(
    createElement(
      SurfaceState,
      {
        empty: state === "empty",
        emptyLabel: "No data",
        error: state === "error" ? "Worker API unavailable" : undefined,
        loading: state === "loading",
      },
      "ready",
    ),
  );
}

async function axeHtml(html: string) {
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>GTM Revenue Engine</title></head><body><main>${html}</main></body></html>`,
  );
  const globalScope = globalThis as Record<string, unknown>;
  const previous = {
    Document: globalScope.Document,
    Element: globalScope.Element,
    HTMLElement: globalScope.HTMLElement,
    Node: globalScope.Node,
    document: globalScope.document,
    window: globalScope.window,
  };
  globalScope.window = dom.window;
  globalScope.document = dom.window.document;
  globalScope.Node = dom.window.Node;
  globalScope.Element = dom.window.Element;
  globalScope.HTMLElement = dom.window.HTMLElement;
  globalScope.Document = dom.window.Document;
  try {
    const axe = (await import("axe-core")).default;
    return await axe.run(dom.window.document, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete globalScope[key];
      } else {
        globalScope[key] = value;
      }
    }
    dom.window.close();
  }
}

function populatedData(): DashboardData {
  return {
    alerts: [{ channel: "system", id: "alert_a11y", provider: "budget", type: "alert.budget" }],
    approvals: [{ gateId: "charge", id: "ap_a11y", runId: "run_a11y", status: "pending" }],
    channels: [{ name: "email", status: "ready" }],
    costs: {
      entries: [{ amountUsd: 0.01, provider: "mock", runId: "run_a11y:capture", unit: "per_call" }],
      totalUsd: 0.01,
    },
    events: [{ channel: "payment", id: "ev_a11y", provider: "mock", type: "payment.captured" }],
    globalPause: false,
    runs: [{ id: "run_a11y", status: "completed", workflowName: "lead-to-cash" }],
  };
}
