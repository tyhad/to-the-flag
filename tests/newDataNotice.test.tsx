import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NewDataNotice } from "../web/components/NewDataNotice";

describe("NewDataNotice markup", () => {
  test("renders message and reload button", () => {
    const html = renderToStaticMarkup(
      <NewDataNotice message="New data from Round 17 is ready." />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("New data from Round 17 is ready.");
    expect(html).toContain(">Reload</button>");
  });
});
