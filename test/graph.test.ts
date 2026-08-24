import { expect, test } from "bun:test";
import {
  transitiveDependents,
  transitiveDependencies,
  topoOrder,
  findCyclePath,
  directDependents,
} from "../src/domain/graph.ts";
import type { Edge } from "../src/domain/graph.ts";

// A depends-on nothing; B depends-on A; C depends-on B; D depends-on A.
//   C -> B -> A ,  D -> A
const edges: Edge[] = [
  { intentId: "B", dependsOnId: "A" },
  { intentId: "C", dependsOnId: "B" },
  { intentId: "D", dependsOnId: "A" },
];

test("transitiveDependents finds everything impacted by reverting A", () => {
  expect(transitiveDependents("A", edges).sort()).toEqual(["B", "C", "D"]);
  expect(transitiveDependents("B", edges).sort()).toEqual(["C"]);
  expect(transitiveDependents("C", edges)).toEqual([]);
});

test("transitiveDependencies finds everything C is built on", () => {
  expect(transitiveDependencies("C", edges).sort()).toEqual(["A", "B"]);
  expect(transitiveDependencies("A", edges)).toEqual([]);
});

test("direct dependents are A's immediate required_by", () => {
  expect(directDependents("A", edges).sort()).toEqual(["B", "D"]);
});

test("topoOrder returns dependencies before dependents; reverse = safe revert order", () => {
  const order = topoOrder(["A", "B", "C", "D"], edges);
  expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
  expect(order.indexOf("B")).toBeLessThan(order.indexOf("C"));
  expect(order.indexOf("A")).toBeLessThan(order.indexOf("D"));
  // revert order (dependents first) must revert C before B before A
  const revert = order.reverse();
  expect(revert.indexOf("C")).toBeLessThan(revert.indexOf("B"));
  expect(revert.indexOf("B")).toBeLessThan(revert.indexOf("A"));
});

test("findCyclePath detects a would-be cycle", () => {
  // Adding A depends-on C would create A->C->B->A
  expect(findCyclePath("A", "C", edges)).not.toBeNull();
  // Adding D depends-on B is fine (no cycle)
  expect(findCyclePath("D", "B", edges)).toBeNull();
});
