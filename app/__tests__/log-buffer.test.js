let LogBuffer;
let originals;

beforeEach(() => {
  jest.resetModules();
  originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  LogBuffer = require("../services/diagnostics/LogBuffer.js");
});
afterEach(() => {
  Object.assign(console, originals);
});

test("captures console output and still calls the original console", () => {
  const spy = jest.fn();
  console.log = spy;
  LogBuffer.installLogCapture();
  console.log("[SafeLink] hello", 42);
  expect(spy).toHaveBeenCalledWith("[SafeLink] hello", 42);
  expect(LogBuffer.getEntries().map((e) => e.message)).toEqual(["[SafeLink] hello 42"]);
});

test("installing twice does not double-log", () => {
  console.log = jest.fn();
  LogBuffer.installLogCapture();
  LogBuffer.installLogCapture();
  console.log("once");
  expect(LogBuffer.getEntries()).toHaveLength(1);
});

test("keeps only the most recent entries", () => {
  console.log = jest.fn();
  LogBuffer.installLogCapture();
  for (let i = 0; i < 1000; i++) console.log(`line ${i}`);
  const entries = LogBuffer.getEntries();
  expect(entries).toHaveLength(800);
  expect(entries[entries.length - 1].message).toBe("line 999");
});

test("handles errors, objects, circular structures and very long lines without throwing", () => {
  console.log = jest.fn();
  console.error = jest.fn();
  LogBuffer.installLogCapture();
  const circular = {};
  circular.self = circular;
  expect(() => {
    console.error(new Error("boom"));
    console.log({ a: 1 });
    console.log(circular);
    console.log("x".repeat(5000));
  }).not.toThrow();
  const [err, obj, , long] = LogBuffer.getEntries();
  expect(err.level).toBe("error");
  expect(err.message).toContain("boom");
  expect(obj.message).toBe('{"a":1}');
  expect(long.message.length).toBeLessThan(710);
});

test("subscribers are notified and can unsubscribe; clear empties the buffer", () => {
  console.log = jest.fn();
  LogBuffer.installLogCapture();
  const cb = jest.fn();
  const unsubscribe = LogBuffer.subscribe(cb);
  console.log("a");
  expect(cb).toHaveBeenCalledTimes(1);
  unsubscribe();
  console.log("b");
  expect(cb).toHaveBeenCalledTimes(1);
  LogBuffer.clearEntries();
  expect(LogBuffer.getEntries()).toHaveLength(0);
  expect(LogBuffer.toText()).toBe("");
});
