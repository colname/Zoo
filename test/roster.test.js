import test from "node:test";
import assert from "node:assert/strict";

import { parseRosterText } from "../src/roster.js";

test("parses a numbered relay list and ignores its heading", () => {
  const names = parseRosterText(`
    单打循环赛，接龙示例：
    1、林丹
    2、何冰娇
    3、安赛龙
    4、李宗伟
  `);

  assert.deepEqual(names, ["林丹", "何冰娇", "安赛龙", "李宗伟"]);
});

test("supports common relay numbering styles", () => {
  const names = parseRosterText(`
    1. 甲
    2）乙
    （3）丙
    4 丁
  `);

  assert.deepEqual(names, ["甲", "乙", "丙", "丁"]);
});

test("supports plain lines and one-line separated names", () => {
  assert.deepEqual(parseRosterText("甲\n乙\n丙"), ["甲", "乙", "丙"]);
  assert.deepEqual(parseRosterText("甲，乙；丙"), ["甲", "乙", "丙"]);
});

test("keeps a doubles combination as one entrant", () => {
  assert.deepEqual(parseRosterText("1、张三 / 李四\n2、王五+赵六"), [
    "张三 / 李四",
    "王五+赵六",
  ]);
});
