import test from "node:test";
import assert from "node:assert/strict";
import { editElementorText, findElementorText } from "../src/presspilot-elementor.js";

test("finds classic Elementor widget text without reading unrelated URL settings", () => {
  const data = [{
    id: "root", elType: "section", settings: {},
    elements: [{
      id: "abc12345", elType: "widget", widgetType: "heading",
      settings: { title: "CALL US NOW +447877310707", link: { url: "tel:+447877310707" } },
      elements: []
    }]
  }];

  const matches = findElementorText(data, 1373, "CALL US NOW +447877310707", "heading");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].elementId, "abc12345");
  assert.equal(matches[0].path, "settings.title");
});

test("edits one matching Elementor widget and preserves its link", () => {
  const data = [{
    id: "root", elType: "section", settings: {},
    elements: [{
      id: "abc12345", elType: "widget", widgetType: "heading",
      settings: { title: "CALL US NOW +447877310707", link: { url: "tel:+447877310707" } },
      elements: []
    }]
  }];

  const result = editElementorText(data, 1373, "CALL US NOW +447877310707", "CALL US NOW<br>+447877310707", "heading");
  assert.equal(result.changed_fields, 1);
  assert.equal((data[0] as any).elements[0].settings.title, "CALL US NOW<br>+447877310707");
  assert.equal((data[0] as any).elements[0].settings.link.url, "tel:+447877310707");
});

test("refuses ambiguous Elementor text unless replaceAll is explicitly enabled", () => {
  const data = [
    { id: "a", elType: "widget", widgetType: "heading", settings: { title: "CALL US NOW +447877310707" }, elements: [] },
    { id: "b", elType: "widget", widgetType: "heading", settings: { title: "CALL US NOW +447877310707" }, elements: [] }
  ];
  assert.throws(() => editElementorText(data, 1, "CALL US NOW +447877310707", "CALL US NOW<br>+447877310707", "heading"), /elementor_text_multiple_matches/);
});

test("replaceAll updates every matching Elementor widget when explicitly requested", () => {
  const data = [
    { id: "a", elType: "widget", widgetType: "heading", settings: { title: "CALL US NOW +447877310707" }, elements: [] },
    { id: "b", elType: "widget", widgetType: "heading", settings: { title: "CALL US NOW +447877310707" }, elements: [] }
  ];
  const result = editElementorText(data, 1, "CALL US NOW +447877310707", "CALL US NOW<br>+447877310707", "heading", true);
  assert.equal(result.changed_fields, 2);
  assert.equal((data[0] as any).settings.title, "CALL US NOW<br>+447877310707");
  assert.equal((data[1] as any).settings.title, "CALL US NOW<br>+447877310707");
});
