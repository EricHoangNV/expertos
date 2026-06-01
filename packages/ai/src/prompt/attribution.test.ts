import { buildAttribution } from "./attribution";

describe("buildAttribution", () => {
  it("derives a rendition disclosure from a named expert voice", () => {
    expect(buildAttribution({ expertName: "Dr. Lan" })).toEqual({
      rendition: true,
      expertName: "Dr. Lan",
      disclosureText: "AI rendition of Dr. Lan",
    });
  });

  it("is the single source of the exact phrase the prompt builder emits", () => {
    // The prompt builder embeds `disclosureText` verbatim, so this string is the contract.
    expect(buildAttribution({ expertName: "Dr. Lan" }).disclosureText).toBe(
      "AI rendition of Dr. Lan",
    );
  });

  it("yields a neutral, no-disclosure result when no voice is given", () => {
    expect(buildAttribution(undefined)).toEqual({
      rendition: false,
      disclosureText: "",
    });
  });

  it("treats an empty expert name as no rendition (guards against a blank disclosure)", () => {
    expect(buildAttribution({ expertName: "" })).toEqual({
      rendition: false,
      disclosureText: "",
    });
  });

  it("ignores guidelines — only the name drives attribution", () => {
    expect(buildAttribution({ expertName: "Mr. Quang", guidelines: "Be terse." })).toEqual({
      rendition: true,
      expertName: "Mr. Quang",
      disclosureText: "AI rendition of Mr. Quang",
    });
  });
});
