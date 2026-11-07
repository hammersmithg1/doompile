/* Safari Share Sheet preprocessing runs only on the page explicitly shared by the user. */
var ExtensionPreprocessingJS = new function () {
  this.run = function (arguments) {
    arguments.completionFunction({
      url: location.href,
      title: document.title,
      selection: window.getSelection ? window.getSelection().toString() : ""
    });
  };
};
