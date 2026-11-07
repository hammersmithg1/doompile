(function () {
  "use strict";
  const design = globalThis.DoompileDesign;
  const names = { expand: "maximize2", collapse: "minimize2", plus: "plus", close: "x", send: "arrow-up", pin: "pin", urgent: "flame" };
  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", String(design.strokeWidth));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const [tag, attrs] of design.icons[names[name] || name]) {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      svg.append(node);
    }
    return svg;
  }
  function button(label, classes, graphic) {
    const node = el("button", {
      type: "button",
      class: classes,
      "aria-label": label,
      title: label,
    });
    if (graphic) node.append(icon(graphic));
    else node.textContent = label;
    return node;
  }
  function mount({
    root,
    context = {},
    onSubmit,
    loadEditor,
    loadTags = async () => [],
    onLayout = () => {},
    autofocus = true,
    initialDraft = {},
    onExpand,
  }) {
    let disposed = false,
      expanded = false,
      busy = false,
      opening = false,
      ready = true,
      rich = null,
      body = null,
      plain = "",
      pinned = !!initialDraft.pinned,
      urgent = !!initialDraft.urgent;
    let tags = Array.isArray(initialDraft.tags) ? initialDraft.tags.slice(0, 20) : [],
      available = [],
      tagOpen = false,
      active = 0,
      choices = [];
    const wrapper = el("div", { class: "dp-composer" });
    const quick = el("div", { class: "dp-quick" }),
      comment = el("textarea", {
        class: "dp-comment",
        rows: "1",
        maxlength: "100000",
        "aria-label": "Комментарий",
      });
    const tools = el("div", { class: "dp-tools" }),
      expand = button("Развернуть редактор", "dp-icon", "expand"),
      send = button("Сохранить в Doompile", "dp-send", "send");
    expand.setAttribute("aria-expanded", "false");
    const quickUrgent = button("Важное", "dp-icon dp-urgent-toggle", "urgent");
    quickUrgent.setAttribute("aria-pressed", "false");
    quickUrgent.setAttribute("aria-pressed", String(urgent));
    tools.append(quickUrgent, expand, send);
    quick.append(comment, tools);
    const full = el("section", {
      class: "dp-expanded",
      "aria-label": "Редактор заметки",
      hidden: "",
    });
    const top = el("header", { class: "dp-modal-top" }),
      draftStatus = el("span", { class: "dp-draft-status" }, "Новая заметка"),
      actions = el("div", { class: "dp-header-actions" });
    const collapse = button("Свернуть редактор", "dp-icon", "collapse"),
      save = button("Сохранить в Doompile", "dp-send", "send"),
      pin = button("Закрепить", "dp-icon", "pin"),
      important = button("Важное", "dp-icon dp-urgent-toggle", "urgent");
    pin.setAttribute("aria-pressed", String(pinned));
    important.setAttribute("aria-pressed", String(urgent));
    pin.onclick = () => {
      pinned = !pinned;
      pin.setAttribute("aria-pressed", String(pinned));
    };
    important.onclick = quickUrgent.onclick = () => {
      urgent = !urgent;
      important.setAttribute("aria-pressed", String(urgent));
      quickUrgent.setAttribute("aria-pressed", String(urgent));
    };
    actions.append(
      pin,
      important,
      el("span", { class: "dp-divider" }),
      collapse,
      save,
    );
    top.append(draftStatus, actions);
    const scroll = el("div", { class: "dp-scroll" }),
      richRoot = el("div", { class: "dp-rich" }),
      options = el("div", { class: "dp-options" });
    const tagRoot = el("div", {
        class: "dp-tag-editor",
        "aria-label": "Теги заметки",
      }),
      tagChips = el("div", { class: "dp-tag-chips" }),
      picker = el("div", { class: "dp-tag-picker" }),
      addTag = button("Добавить тег", "dp-add-tag", "plus");
    addTag.append(document.createTextNode("Добавить тег"));
    const tagInput = el("input", {
      class: "dp-tag-input",
      role: "combobox",
      "aria-label": "Найти или создать тег",
      "aria-expanded": "false",
      "aria-autocomplete": "list",
      placeholder: "Найти или создать тег…",
      maxlength: "65",
      hidden: "",
    });
    const tagMenu = el("div", {
      class: "dp-tag-menu",
      role: "listbox",
      "aria-label": "Подсказки тегов",
      id: "dp-tags-" + Math.random().toString(36).slice(2),
      hidden: "",
    });
    tagInput.setAttribute("aria-controls", tagMenu.id);
    picker.append(addTag, tagInput, tagMenu);
    tagRoot.append(tagChips, picker);
    const key = (value) => value.toLocaleLowerCase();
    function renderChoices() {
      const query = tagInput.value.trim().replace(/^#\s*/, ""),
        selected = new Set(tags.map(key));
      choices = available
        .filter(
          (name) => !selected.has(key(name)) && key(name).includes(key(query)),
        )
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map((name) => ({ name, create: false }));
      if (
        query &&
        query.length <= 64 &&
        !selected.has(key(query)) &&
        !available.some((name) => key(name) === key(query))
      )
        choices.push({ name: query, create: true });
      active = Math.max(0, Math.min(active, choices.length - 1));
      tagMenu.replaceChildren();
      choices.forEach((choice, index) => {
        const option = button(
          choice.create ? `Создать «${choice.name}»` : choice.name,
          "dp-tag-option",
        );
        option.id = tagMenu.id + "-" + index;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === active));
        option.onpointerdown = (event) => event.preventDefault();
        option.onclick = () => add(choice.name);
        tagMenu.append(option);
      });
      if (!choices.length)
        tagMenu.append(
          el(
            "p",
            {},
            selected.has(key(query))
              ? "Этот тег уже добавлен"
              : query.length > 64
                ? "До 64 символов в названии"
                : "Введи название нового тега",
          ),
        );
      if (choices.length)
        tagInput.setAttribute(
          "aria-activedescendant",
          tagMenu.id + "-" + active,
        );
      else tagInput.removeAttribute("aria-activedescendant");
    }
    function toggleTags(open) {
      tagOpen = open;
      tagInput.hidden = tagMenu.hidden = !open;
      addTag.hidden = open;
      tagInput.setAttribute("aria-expanded", String(open));
      if (open) {
        tagInput.value = "";
        active = 0;
        renderChoices();
        tagInput.focus();
      }
    }
    function renderTags() {
      tagChips.replaceChildren();
      for (const name of tags) {
        const chip = el("span", { class: "dp-tag" }, "# " + name),
          remove = button(`Убрать тег ${name}`, "dp-remove-tag", "close");
        remove.onclick = () => {
          tags = tags.filter((tag) => tag !== name);
          renderTags();
          if (tagOpen) renderChoices();
        };
        chip.append(remove);
        tagChips.append(chip);
      }
      addTag.disabled = tags.length >= 20;
      onLayout(expanded);
    }
    function add(value) {
      const name = value.trim().replace(/^#\s*/, "");
      if (
        name &&
        name.length <= 64 &&
        tags.length < 20 &&
        !tags.some((tag) => key(tag) === key(name))
      )
        tags.push(name);
      tagInput.value = "";
      active = 0;
      renderTags();
      renderChoices();
      tagInput.focus();
    }
    addTag.onclick = () => toggleTags(true);
    tagInput.oninput = () => {
      active = 0;
      renderChoices();
    };
    tagInput.onkeydown = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        toggleTags(false);
        addTag.focus();
      } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        active =
          (active + (event.key === "ArrowDown" ? 1 : choices.length - 1)) %
          Math.max(choices.length, 1);
        renderChoices();
        tagMenu.children[active]?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        event.stopPropagation();
        if (choices[active]) add(choices[active].name);
      } else if (event.key === "Backspace" && !tagInput.value && tags.length) {
        tags.pop();
        renderTags();
        renderChoices();
      } else if (event.key === "Tab") {
        if (tagInput.value.trim() && choices[active]) add(choices[active].name);
        toggleTags(false);
      }
    };
    wrapper.addEventListener("pointerdown", (event) => {
      if (tagOpen && !event.composedPath().includes(tagRoot)) toggleTags(false);
    });
    const time = el("input", {
      class: "dp-timestamp",
      placeholder: "0:00",
      "aria-label": "Таймкод",
    });
    time.value =
      context.timestampSeconds == null
        ? ""
        : DoompileCore.formatTime(context.timestampSeconds);
    const timeLabel = el("label", { class: "dp-label" }, "Таймкод");
    timeLabel.append(time);
    options.append(timeLabel);
    timeLabel.hidden = !context.video;
    const readingList = el("input", { type: "checkbox" }),
      readingLabel = el("label", {
        class: "dp-reading",
        title:
          "Офлайн-копией управляет браузер. В заметке останется исходная ссылка.",
      });
    readingLabel.append(
      readingList,
      document.createTextNode("В список чтения"),
    );
    readingList.checked = !!initialDraft.readingList;
    const readingRow = el("div", { class: "dp-reading-row" });
    readingRow.append(readingLabel);
    quick.append(readingRow);
    readingLabel.hidden = !context.url || !context.readingListAvailable;
    function setPlaceholder() {
      comment.placeholder =
        context.url && !context.quote && !context.imageUrl && !context.video
          ? "Сохранить в Doompile…"
          : context.url
            ? "Твоя мысль об этом…"
            : "Написать заметку…";
    }
    comment.value = typeof initialDraft.comment === "string" ? initialDraft.comment : "";
    if (typeof initialDraft.time === "string") time.value = initialDraft.time;
    setPlaceholder();
    scroll.append(tagRoot, richRoot);
    full.append(top, scroll, options);
    const status = el("p", {
      class: "dp-status",
      role: "status",
      "aria-live": "polite",
    });
    wrapper.append(quick, full, status);
    root.append(wrapper);
    function resize() {
      comment.style.height = "39px";
      comment.style.height =
        Math.min(136, Math.max(39, comment.scrollHeight)) + "px";
      onLayout(expanded);
    }
    comment.addEventListener("input", () => {
      if (rich) return;
      plain = comment.value;
      resize();
    });
    function setBusy(value) {
      busy = value;
      wrapper.setAttribute("aria-busy", String(value));
      send.disabled = value || !ready;
      save.disabled = value || !ready;
      expand.disabled = value || !ready;
      collapse.disabled = value && !opening;
    }
    async function submit() {
      if (disposed || busy || !ready) return;
      setBusy(true);
      status.className = "dp-status";
      status.textContent = "Сохраняем…";
      try {
        if (rich) {
          body = rich.getJSON();
          plain = rich.getText();
        } else plain = comment.value;
        const seconds =
          context.video && time.value
            ? DoompileCore.timecode(time.value)
            : null;
        if (context.video && time.value && seconds === null)
          throw new Error("Введи таймкод, например 2:34.");
        await onSubmit({
          comment: plain,
          document: body || undefined,
          tags: tags.join(","),
          pinned,
          urgent,
          timestampSeconds: seconds,
          readingList: readingList.checked,
        });
      } catch (error) {
        if (!disposed) {
          status.className = "dp-status dp-error";
          status.textContent =
            error.message || "Не удалось сохранить. Текст остаётся здесь.";
        }
      } finally {
        if (!disposed) {
          setBusy(false);
          if (!status.classList.contains("dp-error")) status.textContent = "";
        }
      }
    }
    send.onclick = save.onclick = () => void submit();
    function getDraft() {
      return { comment: rich ? rich.getText() : comment.value,
        document: rich ? rich.getJSON() : initialDraft.document,
        pinned, urgent, tags: [...tags], time: time.value, readingList: readingList.checked };
    }
    async function expandEditor() {
      if (disposed || busy || !ready) return;
      if (onExpand) {
        setBusy(true);
        try { await onExpand(getDraft()); }
        catch (error) { status.className = "dp-status dp-error"; status.textContent = error.message; }
        finally { if (!disposed) setBusy(false); }
        return;
      }
      opening = true;
      expanded = true;
      full.hidden = false;
      options.append(readingRow);
      expand.setAttribute("aria-expanded", "true");
      onLayout(true);
      setBusy(true);
      status.className = "dp-status";
      status.textContent = "Открываем редактор…";
      try {
        if (!rich) {
          await loadEditor();
          if (disposed || !expanded) return;
          if (DoompileRichEditor?.version !== 2) throw new Error("Обнови вкладку Safari: модуль редактора устарел. Черновик сохранён здесь.");
          const seconds =
            context.video && time.value
              ? DoompileCore.timecode(time.value)
              : context.timestampSeconds;
          body = initialDraft.document || DoompileCore.captureDocument({
            ...context,
            timestampSeconds: seconds,
            comment: comment.value,
          });
          rich = DoompileRichEditor.mount(richRoot, body, () => {
            body = rich.getJSON();
            plain = rich.getText();
            comment.value = plain;
            onLayout(expanded);
          });
          comment.hidden = true;
        }
        scroll.append(richRoot);
        quick.hidden = true;
        rich.setCompact(false);
        status.textContent = "";
        onLayout(true);
        rich.focus();
        void loadTags()
          .then((value) => {
            if (!disposed) {
              available = [
                ...new Set(
                  value.filter(
                    (tag) => typeof tag === "string" && tag.length <= 64,
                  ),
                ),
              ];
              if (tagOpen) renderChoices();
            }
          })
          .catch(() => {});
      } catch (error) {
        status.className = "dp-status dp-error";
        status.textContent = error.message || "Не удалось открыть редактор.";
      } finally {
        opening = false;
        if (!disposed) setBusy(false);
      }
    }
    expand.onclick = () => void expandEditor();
    collapse.onclick = () => {
      if (rich) {
        body = rich.getJSON();
        plain = rich.getText();
        comment.value = plain;
        quick.insertBefore(richRoot, tools);
        rich.setCompact(true);
      }
      toggleTags(false);
      expanded = false;
      status.textContent = "";
      quick.append(readingRow);
      full.hidden = true;
      quick.hidden = false;
      expand.setAttribute("aria-expanded", "false");
      onLayout(false);
      if (rich) rich.focus();
      else comment.focus({ preventScroll: true });
    };
    time.addEventListener("input", () => {
      const seconds = DoompileCore.timecode(time.value);
      if (rich && seconds !== null) rich.setTimestamp(seconds);
    });
    wrapper.addEventListener(
      "keydown",
      (event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === "Enter" &&
          !event.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          void submit();
        }
      },
      true,
    );
    // Empty space below the document is part of the writing surface.
    scroll.addEventListener("click", event => {
      if (event.target === scroll && rich) rich.focus();
    });
    renderTags();
    if (autofocus) comment.focus({ preventScroll: true });
    return {
      submit,
      expand: expandEditor,
      getDraft,
      setReady(value) {
        ready = value;
        send.disabled = busy || !ready;
        save.disabled = busy || !ready;
        expand.disabled = busy || !ready;
      },
      setContext(next) {
        context = next;
        setPlaceholder();
        timeLabel.hidden = !next.video;
        time.value =
          next.timestampSeconds == null
            ? ""
            : DoompileCore.formatTime(next.timestampSeconds);
        readingLabel.hidden = !next.url || !next.readingListAvailable;
      },
      focus() {
        if (rich) rich.focus();
        else comment.focus({ preventScroll: true });
      },
      destroy() {
        disposed = true;
        rich?.destroy();
        wrapper.remove();
      },
      get expanded() {
        return expanded;
      },
    };
  }
  globalThis.DoompileComposer = { mount };
})();
