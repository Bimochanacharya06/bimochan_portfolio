async function send(regenTxt = null) {
  const txt = (regenTxt ?? inp.value).trim();
  if (!txt && !attachedText) return; 
  if (busy) return;

  // Initialize Chat Sending
  busy = true;
  stopStream = false;
  inp.value = "";
  rsz();
  $("cc").textContent = "0 / 2000";
  $("sndb").disabled = true;
  $("spb").classList.remove("hide");
  $("rb").classList.add("hide");

  appendMsg("user", txt || "(Sent an attachment)", {
    raw: true,
    attached: attachedName || false,
  });

  let backendPayload = txt;
  if (attachedText) {
    backendPayload = `[User attached file: ${attachedName}]\n\`\`\`\n${attachedText}\n\`\`\`\n\nUser Message: ${txt}`;
    clearFile();
  }

  hist.push({ role: "user", content: backendPayload });
  lastP = backendPayload;
  persist();

  const ws = wantsSrch(txt); // Web search toggle
  const te = appendMsg("bot", "", { typing: true, searching: ws, coding: code });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: hist,
        web_search: ws,
        code_mode: code,
        system: sysPrompt(),
      }),
    });

    // Handle Response
    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error("Invalid response format from API");
    }

    if (!data.reply) throw new Error("Claude's response is incomplete or null.");

    if (te?.parentNode) te.remove();
    const replyDiv = appendMsg("bot", data.reply);
    await typewrite(replyDiv.querySelector(".bub"), data.reply);
    hist.push({ role: "assistant", content: data.reply });
    persist();
    $("rb").classList.remove("hide");
  } catch (err) {
    if (te?.parentNode) te.remove(); // Remove typing effect
    appendMsg("bot", `⚠️ ${err.message}`, { raw: true });
    console.error("[CHAT ERROR]", err.message);
  } finally {
    busy = false;
    $("sndb").disabled = false;
    $("spb").classList.add("hide");
    inp.focus();
  }
}
