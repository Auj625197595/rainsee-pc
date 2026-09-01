export const injectChromeWebstoreInstallButton = () => {
  function check() {
    try {
      let btns = document.querySelectorAll("button");
      for (let btn of btns) {
        if(btn.innerText.includes("获取")) {
          //console.log(btn);
          btn.disabled="";
          btn.style.opacity = 1;
          let pluginId = btn.id;
          if(pluginId && pluginId.includes("getOrRemoveButton-")) {
            pluginId = pluginId.replace("getOrRemoveButton-", "").split("-")[0];
            if(pluginId.length < 10) {
              pluginId = null;
            }
          } else {
            pluginId = null;
          }
          if(!pluginId && location.href.includes("detail")) {
            let matches = location.href.match(/\/detail\/[^/]+\/([^?]+)/);
            pluginId = matches[1];
            if(pluginId && pluginId.length < 10) {
              pluginId = null;
            }
          }
          if(!pluginId) {
            continue;
          }
          btn.onclick = function() {
            let newUrl = "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&acceptformat=crx3&x=id%3D" + pluginId + "%26installsource%3Dondemand%26uc";
            console.log(newUrl);
            window.open(newUrl, "_blank");
          }
          // 替换文案跟随应用语言基线(--lang),中文商店页面在英文 UI 下也不再显示中文按钮。
          btn.children[0].innerText = (navigator.language || "").toLowerCase().startsWith("zh") ? "安装" : "Install";
        }
      }
    } catch (e) {
      console.log(e);
    }
  }
  setInterval(check, 1000);
};
