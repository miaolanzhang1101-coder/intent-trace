// The starter workspace: a tiny, real JavaScript project the user can edit,
// run, and let the agent modify. Everything here executes for real in the
// browser (see src/runtime/runner.js) — there is no faked output anywhere.

export const ENTRY_TEST = 'calculator.test.js'

const calculator = `// calculator.js — a small math module.
// Every function here runs for real when you press Run.

function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  return a / b;
}

module.exports = { add, subtract, multiply, divide };
`

const test = `// calculator.test.js — a tiny Jest-style test suite.
// test(name, fn) and expect(value) are provided by the runner.

const calc = require('./calculator');

test('add sums two numbers', () => {
  expect(calc.add(2, 3)).toBe(5);
});

test('subtract finds the difference', () => {
  expect(calc.subtract(10, 4)).toBe(6);
});

test('multiply scales two numbers', () => {
  expect(calc.multiply(3, 4)).toBe(12);
});

test('divide splits a into b parts', () => {
  expect(calc.divide(12, 3)).toBe(4);
});
`

// The immutable baseline the workspace starts from.
export const BASELINE_FILES = Object.freeze({
  'calculator.js': calculator,
  'calculator.test.js': test,
})

export const FILE_ORDER = ['calculator.js', 'calculator.test.js']

export function freshFiles() {
  return { ...BASELINE_FILES }
}
