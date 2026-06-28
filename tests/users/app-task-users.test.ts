import assert from "node:assert/strict";
import { test } from "node:test";
import { mapDbUserRow } from "../../src/users/app-task-users.js";

test("mapDbUserRow maps blocked bit from SQL", () => {
  const active = mapDbUserRow({
    id: 1,
    real_name: "Иван",
    email: "i@test.ru",
    blocked: 0,
  });
  const blocked = mapDbUserRow({
    id: 8166,
    real_name: "Максим Макаров",
    email: "m@test.ru",
    blocked: 1,
  });
  assert.equal(active?.blocked, false);
  assert.equal(blocked?.blocked, true);
  assert.equal(blocked?.id, 8166);
});
