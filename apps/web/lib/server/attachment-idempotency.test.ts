import { testEnvironment } from "./test-accounts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNote } from "@doompile/core";
import { store } from "./store";
import { POST } from "../../app/api/attachments/route";
test("lost upload/PUT responses retry without duplicate files or conflict copies", async () => {
  const fixture=testEnvironment();
  const {directory}=fixture;
  const account=fixture.account();
  const id=crypto.randomUUID();
  async function upload(text="abc") {
    const body=new FormData();body.set("file",new Blob([text],{type:"text/plain"}),"file.txt");
    return POST(new Request("https://notes.example/api/attachments",{method:"POST",headers:{Authorization:`Bearer ${account.token}`,"X-Doompile-Upload-ID":id},body}));
  }
  try {
    const first=await upload(); assert.equal(first.status,201);
    const attachment=(await first.json()).attachment;
    const note=createNote({plainText:"With file",attachments:[attachment]});
    const saved=store(account.user.id).save(note,0);assert.equal(saved.ok,true);
    const retry=await upload();assert.equal(retry.status,200);
    const repeated=(await retry.json()).attachment;
    assert.deepEqual(repeated,attachment);
    assert.deepEqual(store(account.user.id).save({...note,attachments:[repeated]},0),saved);
    assert.deepEqual(readdirSync(join(directory,"users",account.user.id,"objects")),[store(account.user.id).attachmentKey(id)]);
    const wrong=await upload("different content");assert.equal(wrong.status,409);
    assert.equal(readFileSync(join(directory,"users",account.user.id,"objects",store(account.user.id).attachmentKey(id)!),"utf8"),"abc");
  } finally { fixture.cleanup(); }
});
