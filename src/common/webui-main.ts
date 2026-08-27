import {WEBUI_BASE_URL, WEBUI_URL_SUFFIX} from '~/constants/files';
import {Application} from "~/main/application";

export const getNativeWebUIURL = (hostname: string) =>
  `${WEBUI_BASE_URL}${hostname}${WEBUI_URL_SUFFIX}`;

export const getWebUIURL = (hostname: string) => {
  if (hostname == "newtab") {
    const newtabUrl = Application.instance.settings.object.newtab;
    if (newtabUrl && newtabUrl != "") {
      if (Application.instance.tempTabUrl) {
        return Application.instance.tempTabUrl;
      }
      return newtabUrl.split("\n")[0];
    }
  }
  return getNativeWebUIURL(hostname);
}
