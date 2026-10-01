import test from "node:test";
import assert from "node:assert/strict";
import { outcomeName } from "../src/outcomes.ts";

test("normalizes supported lead outcomes",()=>{
  assert.equal(outcomeName("sale"),"sale");
  assert.equal(outcomeName("NO-SALE"),"no_sale");
  assert.equal(outcomeName("pending-sale"),"pending_sale");
  assert.equal(outcomeName("unknown"),null);
});
