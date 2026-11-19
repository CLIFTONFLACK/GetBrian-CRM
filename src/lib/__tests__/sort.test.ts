import test from "node:test";
import assert from "node:assert/strict";
import { sortHref } from "../sort.ts";

const dirOf = (href: string) => new URLSearchParams(href.slice(1)).get("dir");

test("first click on a column sorts ascending unless told otherwise", () => {
  assert.equal(dirOf(sortHref({}, "title")), "asc");
  assert.equal(dirOf(sortHref({ sort: "status", dir: "desc" }, "title")), "asc");
});

test("first click on the rating column can sort highest first", () => {
  assert.equal(dirOf(sortHref({}, "listing_rating", "desc")), "desc");
  assert.equal(dirOf(sortHref({ sort: "title", dir: "asc" }, "listing_rating", "desc")), "desc");
});

test("clicking the active column toggles, whatever the first direction was", () => {
  assert.equal(dirOf(sortHref({ sort: "listing_rating", dir: "desc" }, "listing_rating", "desc")), "asc");
  assert.equal(dirOf(sortHref({ sort: "listing_rating", dir: "asc" }, "listing_rating", "desc")), "desc");
  assert.equal(dirOf(sortHref({ sort: "title" }, "title")), "desc");
});
