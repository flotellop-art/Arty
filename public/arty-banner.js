// Bandeau pre-launch waitlist.
// Affiche un bandeau noir en haut de l'app preview web (tryarty.com).
// Pas affiche dans l'app Android Capacitor (detection par hostname).
// Le visiteur peut dismiss, on persiste via localStorage.
(function () {
  var host = (location.hostname || "").toLowerCase();
  var isPublicWeb =
    host === "tryarty.com" ||
    host === "www.tryarty.com" ||
    host.endsWith(".pages.dev");
  if (!isPublicWeb) return;

  var dismissed = false;
  try {
    dismissed = localStorage.getItem("arty-prelaunch-banner-dismissed") === "1";
  } catch (e) {}
  if (dismissed) return;

  var b = document.getElementById("arty-prelaunch-banner");
  if (!b) return;

  b.style.display = "block";
  document.body.classList.add("arty-banner-visible");

  var btn = document.getElementById("arty-prelaunch-banner-close");
  if (btn) {
    btn.addEventListener("click", function () {
      b.style.display = "none";
      document.body.classList.remove("arty-banner-visible");
      try {
        localStorage.setItem("arty-prelaunch-banner-dismissed", "1");
      } catch (e) {}
    });
  }
})();
