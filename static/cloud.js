(function () {
  async function uploadForm(form, api, notify) {
    const fileInput = form.querySelector('input[type="file"]');
    const files = Array.from(fileInput.files || []);
    if (!files.length) throw new Error("Pilih minimal satu file terlebih dahulu.");
    const storeName = form.elements.storeName.value || "ventura";
    const kind = form.elements.kind.value || "auto";
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Mengirim..."; }
    const results = [];
    try {
      for (const file of files) {
        if (submitButton) submitButton.textContent = "Mengirim " + file.name + "...";
        if (notify) notify("Mengirim " + file.name + "...", "info", false);
        const formData = new FormData();
        formData.append("storeName", storeName);
        formData.append("kind", kind);
        formData.append("files", file, file.name);
        const result = await api("/api/upload", { method: "POST", body: formData });
        results.push(result);
      }
      if (submitButton) { submitButton.textContent = "Upload"; submitButton.disabled = false; }
      return results;
    } catch (err) {
      if (submitButton) { submitButton.textContent = "Upload"; submitButton.disabled = false; }
      if (notify) notify(err.message || "Gagal upload", "warn", false);
      throw err;
    }
  }
  window.CloudFinance = { uploadForm };
})();
