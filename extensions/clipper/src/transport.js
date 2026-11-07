(function () {
  "use strict";
  // Some Safari versions leave a content-script reply pending. The background
  // also acknowledges requests directly in the same isolated frame.
  function create(api) {
    const pending = new Map();
    function settle(id, result) {
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      result?.error
        ? entry.reject(new Error(result.error))
        : entry.resolve(result);
    }
    function request(message, timeout = 10000) {
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        let channelError = "";
        const timer = setTimeout(
          () =>
            settle(requestId, {
              error:
                "Расширение не ответило. Попробуй ещё раз; текст остаётся в редакторе. Если не помогает, выключи и включи Doompile в настройках Safari." +
                (channelError ? " " + channelError : ""),
            }),
          timeout,
        );
        pending.set(requestId, { resolve, reject, timer });
        try {
          Promise.resolve(
            api.runtime.sendMessage({ ...message, requestId }),
          ).then(
            (result) => {
              // An absent callback response is not an acknowledgement.
              if (result !== undefined) settle(requestId, result);
            },
            (error) => {
              // A closed reply port does not mean the background failed to save.
              // Give the isolated acknowledgement its full deadline to arrive.
              channelError = String(error.message || error);
            },
          );
        } catch (error) {
          settle(requestId, { error: String(error.message || error) });
        }
      });
    }
    function destroy() {
      for (const [id] of pending) settle(id, { error: "Редактор закрыт." });
    }
    return { request, settle, destroy };
  }
  globalThis.DoompileTransport = { create };
})();
